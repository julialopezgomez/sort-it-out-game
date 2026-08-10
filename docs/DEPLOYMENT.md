# Deployment

## 1. Create and prepare Supabase

1. Create a free project at [Supabase](https://supabase.com/dashboard).
2. Install the Supabase CLI, sign in, and link this checkout to the project:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REFERENCE
   supabase db push
   ```

3. In the dashboard, confirm that Database → Publications → `supabase_realtime` includes
   `room_events`. Migration `0020_security.sql` normally does this automatically.
4. From Project Settings → API, copy the project URL and the public anon/publishable key.

Never use the service-role key in GitHub Actions or in a `VITE_` variable.

## 2. Configure GitHub

In `julialopezgomez/sort-it-out-game`:

1. Open Settings → Secrets and variables → Actions → Variables.
2. Add `VITE_SUPABASE_URL` with the Supabase project URL.
3. Add `VITE_SUPABASE_ANON_KEY` with the public anon/publishable key.
4. Optionally add `VITE_SUPABASE_DASHBOARD_URL`, for example
   `https://supabase.com/dashboard/project/YOUR_PROJECT_REFERENCE`.
5. Open Settings → Pages and choose **GitHub Actions** as the source.

The public anon key is not a secret. Database grants and RPC validation are the security
boundary. Repository variables make that expectation explicit and allow forked builds to fail
cleanly when they are not configured.

## 3. Deploy

Push to `main`, or run **Test and deploy to GitHub Pages** manually under Actions. The workflow
runs formatting, lint, TypeScript, unit tests, a production build, and browser smoke tests before
deployment.

The site will be available at:

```text
https://julialopezgomez.github.io/sort-it-out-game/
```

Room links use hash routing, such as:

```text
https://julialopezgomez.github.io/sort-it-out-game/#/join/ABCDEF
```

## Custom domain later

If the game receives its own custom domain, change `VITE_BASE_PATH` in
`.github/workflows/deploy-pages.yml` from `/sort-it-out-game/` to `/`, then configure the custom
domain in Settings → Pages. No router changes are needed.

## Supabase Free pauses

If the project is paused after inactivity, open its Supabase dashboard and select Restore.
The deployed frontend will start working again when the project is available; it does not need
to be rebuilt. Keep a copy of the migrations in this repository as the recovery source of truth.
