# API Routes

Two microservices, each with their own route prefix. All routes return JSON.

## Auth Service (`/auth`)

Handles Singpass login and issues the JWT session token used by every other
service. Source: `services/auth/src/routes/singpassAuth.ts`.

| Method | Path                | Auth required | Description |
|--------|---------------------|----------------|-------------|
| GET    | `/health`            | No  | Liveness check. Returns `{ status: "ok", service: "auth" }`. |
| GET    | `/auth/singpass/login` | No  | Starts the Singpass OIDC flow. Generates `state`/`nonce`/PKCE `codeVerifier`, stores them server-side, and redirects the browser to Singpass's authorization URL. |
| GET    | `/auth/singpass/callback` | No (validates `state`) | Singpass redirects here with `code` + `state`. Exchanges the code for tokens, verifies the `nonce`, extracts the user's Singpass UUID, upserts a `User` row keyed on `singpassSub`, and returns `{ accessToken, user: { id } }`. `accessToken` is the JWT used for all subsequent requests. |
| GET    | `/auth/me`            | Yes (JWT) | Returns the caller's own user record: `{ id, singpassSub, createdAt }`. |

## Matching Service (`/matching`)

Everything under `/matching` requires a valid JWT (`requireAuth` middleware
applied in `services/matching/src/app.ts`, decoded via `withUser` in each
handler to get `req.userId`).

| Method | Path                          | Description |
|--------|-------------------------------|-------------|
| GET    | `/health`                      | Liveness check. Returns `{ status: "ok", service: "matching" }`. No auth. |
| PUT    | `/matching/profile`            | Create or update the caller's `RunnerProfile` (upsert). Body: `{ paceSecondsPerKm, mrtStations[] }`. Pace must be 180–900 s/km; `mrtStations` validated against the known MRT station list and must be non-empty. |
| GET    | `/matching/profile`            | Fetch the caller's own `RunnerProfile`. `404` if none exists yet. |
| GET    | `/matching/candidates`         | List up to 50 potential match candidates. Excludes the caller and anyone already swiped on. Filters to profiles within 30s/km of the caller's pace and sharing at least one MRT station. Sorted newest-profile-first. `400` if the caller has no profile yet. |
| POST   | `/matching/candidates/:userId/swipe` | Record a swipe decision (`ACCEPT` or `PASS`) on candidate `:userId`. If both sides have swiped `ACCEPT` on each other, creates a `Match`. Uses a `Serializable` transaction with retry to handle two users accepting at the same instant; `409` if the caller already swiped on this candidate. |
| GET    | `/matching/matches`            | List the caller's confirmed mutual matches, newest first: `{ id, otherUserId, createdAt }[]`. |

## User Flow

1. **Login** — client hits `GET /auth/singpass/login`, is redirected through
   Singpass, and lands back on `GET /auth/singpass/callback`, which returns
   a JWT `accessToken`. The client stores this and sends it as a bearer
   token on every subsequent request.
2. **Build a profile** — client calls `PUT /matching/profile` with pace and
   selected MRT stations. Required before candidates can be browsed.
3. **Browse candidates** — client calls `GET /matching/candidates` to get a
   list of compatible runners (matching pace band + shared MRT station,
   not yet swiped on).
4. **Swipe** — for each candidate, client calls
   `POST /matching/candidates/:userId/swipe` with `ACCEPT` or `PASS`.
   - `PASS` just records the decision; the candidate won't be shown again.
   - `ACCEPT` records the decision, and if the other user already `ACCEPT`ed
     the caller, a `Match` is created immediately for both sides.
5. **View matches** — client calls `GET /matching/matches` to list confirmed
   mutual matches and start chatting (chat is a separate, not-yet-covered
   service — see `docs/architecture.md`).

Candidates are never persisted as "assigned" — the candidate list in step 3
is recomputed fresh from `RunnerProfile` + `Swipe` rows on every request.
