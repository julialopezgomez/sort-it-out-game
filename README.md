# Sort It Out

Sort It Out is a free bilingual party game for 2–30 players. One Ranker privately orders
five unrelated concepts; everyone else tries to reproduce that exact order. The app supports
English and Spanish independently for every player.

The production architecture is deliberately small and free to operate:

- Vite, React, TypeScript and Tailwind compile to a static site.
- GitHub Pages hosts the frontend.
- Supabase Free provides Postgres, RPCs and Realtime notifications.
- Players join with a six-character room code and display name. There are no accounts.

## Local development

Requirements: Node.js 22, pnpm 9, and a Supabase project with this repository's migrations
already applied. Without the migrations, `pnpm dev` runs but every request fails. If you don't
have a project set up yet, do step 1 of the [deployment guide](docs/DEPLOYMENT.md) first.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` with that project's values. Never
use a Supabase service-role key in this frontend.

Run the complete frontend release gate with:

```bash
pnpm verify
```

See [Testing](docs/TESTING.md) for database and browser integration tests.

## Deploying this repository

This repository is a GitHub project site. For the repository
`julialopezgomez/sort-it-out-game`, its default URL is:

```text
https://julialopezgomez.github.io/sort-it-out-game/
```

It is independent of the owner site at `https://julialopezgomez.github.io/`. Read the
[deployment guide](docs/DEPLOYMENT.md) for the exact Supabase project choices, the recommended
no-CLI GitHub integration, repository variables, first push, and GitHub Pages switch.

## Free-tier maintenance

Supabase may pause a free project after inactivity. Players receive a simple temporary
unavailability message; the owner receives instructions to open the Supabase dashboard and
restore the project. No code change is needed after a normal restore.

Completed game data can be removed from the Host's History screen. The database also includes
`cleanup_old_data(interval)` for an owner-controlled retention policy; no automatic destructive
schedule is enabled.

To add or edit factory cards, see [Factory cards](docs/FACTORY_CARDS.md).

## Privacy and security

The anonymous browser key is intentionally visible in the compiled frontend. Direct anonymous
access to game tables is revoked; narrowly scoped `SECURITY DEFINER` RPCs validate identity,
phase, role and payloads. Realtime rows are notification-only and contain no rankings.

This is a family-game identity model, not strong authentication. Someone who knows a room code
and the exact name of a disconnected player could reclaim that place. Do not use the app for
adversarial or prize-based competition. See [Security](docs/SECURITY.md).
