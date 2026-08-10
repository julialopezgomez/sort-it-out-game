# Testing

## Frontend release gate

```bash
pnpm verify
```

This checks formatting, lint, strict TypeScript, 194+ unit assertions, and the production PWA
bundle.

## Database integration tests

With the Supabase CLI and Docker installed:

```bash
supabase start
supabase db reset
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:test
```

`supabase db reset` applies every migration. `pnpm db:test` runs
`supabase/tests/game_flow.sql` in one transaction and rolls it back. The script covers full-cycle
scoring, non-submitters, skipped-turn penalties, timer expiry, pause/resume, reconnection,
secrecy, payload validation, late joins, idempotency, dictionaries, limits, play-again, legal
transitions, and anonymous table access.

You can point `DATABASE_URL` at a disposable remote test project, but never run development tests
against production data.

## Browser tests

Install Chromium once:

```bash
pnpm e2e:install
```

Build-only smoke tests require no backend:

```bash
pnpm e2e:build
```

Credentialed multiplayer tests use a disposable Supabase project with the migrations applied:

```bash
export E2E_SUPABASE_URL=https://YOUR_TEST_PROJECT.supabase.co
export E2E_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
export VITE_SUPABASE_URL="$E2E_SUPABASE_URL"
export VITE_SUPABASE_ANON_KEY="$E2E_SUPABASE_ANON_KEY"
pnpm e2e:multiplayer
```

When those values are absent, multiplayer tests report themselves as skipped; they must never be
described as having passed.
