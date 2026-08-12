# RunPartner SG

Running partner matchmaking app for Singapore. Matches runners by pace and shared MRT station. Auth via Singpass.

## Rules

1. TypeScript strict mode everywhere. No `any` without justification.
2. One microservice at a time. Don't modify multiple services in one change.
3. All DB access through Prisma. No raw SQL except in migrations.
4. Validate all inputs with zod.
5. Mobile: follow ui-inspo.png for visual direction (palette, typography, components).
6. Don't touch: docker-compose.yml, .env, infra/, CI config — ask first.
7. Don't add features outside the MVP features listed in docs/architecture.md.

## Key Decisions

- Compatibility rules: pace within 30s/km, at least one shared selected MRT station
- Chat: Socket.IO, messages stored in Redis (24h TTL)
- Singpass: use TEST environment only. See docs/singpass-integration.md

## When Starting a New Task

<!-- - Read docs/architecture.md for full system design
- Check docs/api.md for endpoint contracts -->

- One feature per conversation. State which service you're working in.
