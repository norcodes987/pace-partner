import { getPrisma } from "@pace-partner/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testEnv } from "./fixtures/testEnv.js";
import { createTestUser, signTestToken } from "./helpers/testUser.js";

const prisma = getPrisma(testEnv.DATABASE_URL);
const app = createApp(testEnv);

describe("POST /matching/candidates/:userId/swipe", () => {
  it("returns 401 without a token", async () => {
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(401);
  });

  it("returns 400 when swiping on yourself", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app)
      .post(`/matching/candidates/${user.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(400);
  });

  it("returns 400 for an unknown target user", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const response = await request(app)
      .post("/matching/candidates/nonexistent-user-id/swipe")
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid decision value", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "MAYBE" });
    expect(response.status).toBe(400);
  });

  it("records a PASS with no match created", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "PASS" });
    expect(response.status).toBe(201);
    expect(response.body.swipe).toMatchObject({ userId: user.id, targetUserId: target.id, decision: "PASS" });
    expect(response.body.match).toBeNull();
  });

  it("returns 409 when swiping on the same target twice", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "PASS" });
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(409);
  });

  it("creates no match on a one-sided ACCEPT", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);
    const response = await request(app)
      .post(`/matching/candidates/${target.id}/swipe`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "ACCEPT" });
    expect(response.status).toBe(201);
    expect(response.body.match).toBeNull();
  });

  it("creates a match when both sides ACCEPT", async () => {
    const userA = await createTestUser(prisma);
    const tokenA = signTestToken(userA.id, testEnv.JWT_SECRET);
    const userB = await createTestUser(prisma);
    const tokenB = signTestToken(userB.id, testEnv.JWT_SECRET);

    await request(app)
      .post(`/matching/candidates/${userB.id}/swipe`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ decision: "ACCEPT" });

    const response = await request(app)
      .post(`/matching/candidates/${userA.id}/swipe`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ decision: "ACCEPT" });

    expect(response.status).toBe(201);
    expect(response.body.match).not.toBeNull();
    expect([userA.id, userB.id]).toContain(response.body.match.userAId);
    expect([userA.id, userB.id]).toContain(response.body.match.userBId);
  });
});

describe("POST /matching/candidates/:userId/swipe — concurrent writes", () => {
  it("handles two simultaneous identical swipes without a 500 (one 201, one 409)", async () => {
    const user = await createTestUser(prisma);
    const token = signTestToken(user.id, testEnv.JWT_SECRET);
    const target = await createTestUser(prisma);

    const [responseA, responseB] = await Promise.all([
      request(app)
        .post(`/matching/candidates/${target.id}/swipe`)
        .set("Authorization", `Bearer ${token}`)
        .send({ decision: "PASS" }),
      request(app)
        .post(`/matching/candidates/${target.id}/swipe`)
        .set("Authorization", `Bearer ${token}`)
        .send({ decision: "PASS" }),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it("handles two simultaneous mutual ACCEPTs without a 500 and never loses the match", async () => {
    const userA = await createTestUser(prisma);
    const tokenA = signTestToken(userA.id, testEnv.JWT_SECRET);
    const userB = await createTestUser(prisma);
    const tokenB = signTestToken(userB.id, testEnv.JWT_SECRET);

    const [responseA, responseB] = await Promise.all([
      request(app)
        .post(`/matching/candidates/${userB.id}/swipe`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ decision: "ACCEPT" }),
      request(app)
        .post(`/matching/candidates/${userA.id}/swipe`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ decision: "ACCEPT" }),
    ]);

    expect(responseA.status).toBe(201);
    expect(responseB.status).toBe(201);

    // Under Postgres SERIALIZABLE, this is a classic write-skew shape: whichever
    // transaction's snapshot is taken first can legitimately commit before the other
    // side's swipe exists, and will correctly report match: null for THAT response —
    // it did not lose a race, it genuinely observed no reciprocal yet. The other
    // transaction either sees the reciprocal directly, or gets aborted with P2034 and
    // retries into finding/creating it. So at most one of the two HTTP responses can
    // legitimately have a null match; it is impossible under correct Postgres semantics
    // for BOTH responses to always show non-null (that would require Postgres to
    // retroactively invalidate an already-committed transaction, which it never does).
    //
    // The property that actually matters — the one the pre-fix bug violated — is that
    // the match is never permanently lost: at least one response must carry it, and a
    // Match row must actually exist afterward for the pair. Under the old READ COMMITTED
    // + no-retry bug, BOTH responses came back with match: null AND no Match row was ever
    // created, permanently, because both Swipe rows already existed and any retry hit the
    // 409 pre-check forever. This assertion fails if that regresses.
    const matches = [responseA.body.match, responseB.body.match];
    expect(matches.some((match) => match !== null)).toBe(true);

    const nonNullMatches = matches.filter((match) => match !== null);
    for (const match of nonNullMatches) {
      expect([userA.id, userB.id]).toContain(match.userAId);
      expect([userA.id, userB.id]).toContain(match.userBId);
    }
    if (nonNullMatches.length === 2) {
      expect(nonNullMatches[0].id).toBe(nonNullMatches[1].id);
    }

    const [dbUserAId, dbUserBId] = [userA.id, userB.id].sort();
    const persistedMatch = await prisma.match.findUnique({
      where: { userAId_userBId: { userAId: dbUserAId, userBId: dbUserBId } },
    });
    expect(persistedMatch).not.toBeNull();

    const swipeA = await prisma.swipe.findUnique({
      where: { userId_targetUserId: { userId: userA.id, targetUserId: userB.id } },
    });
    const swipeB = await prisma.swipe.findUnique({
      where: { userId_targetUserId: { userId: userB.id, targetUserId: userA.id } },
    });
    expect(swipeA?.decision).toBe("ACCEPT");
    expect(swipeB?.decision).toBe("ACCEPT");
  });
});
