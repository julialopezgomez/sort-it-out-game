# Deployment

The recommended setup uses [Supabase's GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration).
It deploys the database migrations committed in this repository, so the Supabase CLI does not
need to be installed locally.

## 1. Create the Supabase project

On Supabase's **Create a new project** screen, use these settings:

| Setting                         | Choose                                                               |
| ------------------------------- | -------------------------------------------------------------------- |
| Organization                    | `julialopezgomez` (Free)                                             |
| GitHub repository               | `julialopezgomez/sort-it-out-game`                                   |
| Project name                    | `sort-it-out-game`                                                   |
| Database password               | Keep the generated strong password and save it in a password manager |
| Region                          | Europe, or the European region closest to the expected players       |
| Enable Data API                 | On                                                                   |
| Automatically expose new tables | Off                                                                  |
| Enable automatic RLS            | On                                                                   |

If GitHub asks for permission, authorize Supabase for this repository. If the integration asks
for more settings, choose:

- Production branch: `main`
- Supabase directory / working directory: `.` (the `supabase` folder is at the repository root)
- Deploy to production: On
- Automatic or preview branches: Off (they are not needed for this project)

Finish creating the project. It is normal if the first Supabase deployment has nothing new to
apply yet: the migrations are currently in the local checkout and will be deployed after the
first push to `main`.

## 2. Copy the frontend connection values

In the new Supabase project, open **Project Settings → API** (or **Connect → App Frameworks** in
the newer dashboard) and copy:

- Project URL, beginning with `https://`
- Publishable key, normally beginning with `sb_publishable_`, or the legacy public `anon` key

Do not copy the secret key or the legacy `service_role` key. Those credentials must never be
placed in this repository, GitHub Actions, `.env`, or any `VITE_` variable.

## 3. Configure the GitHub repository

In `julialopezgomez/sort-it-out-game`:

1. Open **Settings → Secrets and variables → Actions → Variables**.
2. Add `VITE_SUPABASE_URL` with the Supabase project URL.
3. Add `VITE_SUPABASE_ANON_KEY` with the publishable or public anon key.
4. Optionally add `VITE_SUPABASE_DASHBOARD_URL`, for example
   `https://supabase.com/dashboard/project/YOUR_PROJECT_REFERENCE`.
5. Open **Settings → Pages**, and under **Build and deployment → Source**, choose
   **GitHub Actions**.

The publishable/anon key is designed to be public in a browser app. Database grants, Row Level
Security and RPC validation are the security boundary.

## 4. Commit and push

Before committing, check that no `.env` file is staged:

```bash
git status --short
git check-ignore .env
```

The second command should print `.env` if that file exists. Then commit and push the app:

```bash
git add .
git status --short
git commit -m "Build Sort It Out game"
git push origin main
```

Review the second `git status --short` before committing. It must not list `.env` or any private
credential file.

The push starts two deployments:

1. Supabase applies the files in `supabase/migrations` to the production database.
2. GitHub Actions verifies the frontend and deploys it to GitHub Pages.

In GitHub, open **Actions** and wait for **Test and deploy to GitHub Pages** to succeed. Also check
the Supabase integration/deployment status. The Pages deployment may finish first; the game will
be fully usable once both have succeeded.

The site will be available at:

```text
https://julialopezgomez.github.io/sort-it-out-game/
```

Room links use hash routing, such as:

```text
https://julialopezgomez.github.io/sort-it-out-game/#/join/ABCDEF
```

## 5. Confirm the database deployment

After the Supabase deployment succeeds:

1. In Supabase, open **Database → Migrations** and confirm that the repository migrations were
   applied.
2. Open **Database → Publications → `supabase_realtime`** and confirm that it includes
   `room_events`. Migration `0020_security.sql` normally configures this automatically.
3. Open the deployed game in two browser windows and complete one short test game.

Do not paste the migration files into the Supabase SQL Editor. Doing that bypasses
[Supabase's migration history](https://supabase.com/docs/guides/deployment/database-migrations)
and can cause later GitHub or CLI deployments to conflict.

## CLI fallback

Use this only if the GitHub integration cannot be enabled. Install the Supabase CLI, sign in,
link the checkout and deploy the same migration files:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REFERENCE
supabase db push --dry-run
supabase db push
```

Once one deployment method is chosen, continue treating `supabase/migrations` as the source of
truth. Avoid making schema changes manually in the production dashboard.

## Custom domain later

If the game receives its own custom domain, change `VITE_BASE_PATH` in
`.github/workflows/deploy-pages.yml` from `/sort-it-out-game/` to `/`, then configure the custom
domain in **Settings → Pages**. No router changes are needed.

## Supabase Free pauses

If the project is paused after inactivity, open its Supabase dashboard and select **Restore**.
The deployed frontend will start working again when the project is available; it does not need
to be rebuilt. Keep the migrations in this repository as the recovery source of truth.
