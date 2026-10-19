# Task 8 — Deploy to Fly and verify from Vercel (do-it-yourself guide)

**Goal:** the C++ server runs on Fly.io, your production Next.js app on Vercel points at it, and a real logged-in user can call `https://<your-vercel-domain>/cpp-api/me` and get their own user id back. That's success criterion 3 of the spec, and the end of sub-project 1.

**⚠️ This task publishes things and changes production config.** No code to type — just commands, and *you* run all of them, because they need your Fly/Vercel logins and your secrets. Never paste secrets into chat or into a commit. Tell me before you start Step 2 if you want me to double-check anything first.

Prerequisites: Tasks 1–7 committed, `docker build` from Task 6 worked, and the local end-to-end check from Task 7 returned your user id.

---

## Step 1 — Install flyctl and log in

```bash
brew install flyctl
fly auth login
```

- `fly auth login` opens your browser. Fly requires a payment card on the account even for tiny apps; with `min_machines_running = 0` and a 512 MB shared machine, idle cost is close to zero.

---

## Step 2 — Create the app and set secrets

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
fly launch --no-deploy --copy-config --name tradeai-api
```

- `--copy-config` — use our `fly.toml` instead of generating a new one.
- `--no-deploy` — just create the app; we set secrets first, otherwise the first deploy would crash with `[config] missing required env var DATABASE_URL`.
- If `tradeai-api` is taken, pick another name (e.g. `tradeai-api-<yourname>`) and change the `app = "..."` line in `fly.toml` to match. If `fly launch` asks to tweak settings, say no.

Now the secrets. Use the same values as your `backend/.env`:

```bash
fly secrets set DATABASE_URL='<session pooler URL>' SUPABASE_URL='https://<ref>.supabase.co'
# only if your project uses the legacy HS256 secret (you'd have needed it in Task 7):
fly secrets set SUPABASE_JWT_SECRET='<secret>'
```

- Fly secrets become environment variables inside the machine — exactly what `Config::fromEnv()` reads. They're encrypted and never shown again (`fly secrets list` shows names only).
- Wrap values in **single quotes** so the shell doesn't interpret `$` or `!` inside your DB password.
- To keep the secret out of your shell history, put a space before the command (zsh ignores space-prefixed commands if `HIST_IGNORE_SPACE` is set) — or run `fly secrets import < .env`, which reads the file directly.
- `PORT`, `ALLOWED_AUDIENCE`, `DB_POOL_SIZE`, `HTTP_THREADS` have sensible defaults; no need to set them.

---

## Step 3 — Deploy and check health

```bash
fly deploy
```

The first deploy builds the Docker image on Fly's remote builder — expect ~20 minutes (same dependency compile as Task 6). Later deploys reuse the cache.

```bash
curl -s https://<app>.fly.dev/healthz   # {"data":{"status":"ok"},"success":true}
curl -s https://<app>.fly.dev/readyz    # {"data":{"status":"ready"},"success":true}
```

- `<app>` = the name from Step 2.
- The first request after idling may take a couple of seconds — that's the machine waking up (`auto_start_machines`).
- `/readyz` gives **503** → the server can't reach Supabase. Check `fly logs` for the `[readyz]` line. Usually the DATABASE_URL secret (typo, or the direct host instead of the pooler).
- Deploy fails / machine keeps restarting → `fly logs` — look for a `[config]` line.

---

## Step 4 — Point Vercel at it

Add `CPP_API_URL=https://<app>.fly.dev` to the Vercel project's **Production** (and **Preview**) environment variables — either in the dashboard (Project → Settings → Environment Variables), or:

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
vercel env add CPP_API_URL production
vercel env add CPP_API_URL preview
```

Then **redeploy** (Deployments → ⋯ → Redeploy, or push/redeploy however you normally do). Env vars and rewrites are read at build time, so the existing deployment won't pick it up.

- No trailing slash on the URL — the rewrite appends `/:path*` itself.
- Not `NEXT_PUBLIC_` — server-only, as in Task 7.

---

## Step 5 — Verify success criterion 3

Use the `TOKEN` from Task 7 (if it's over an hour old, fetch a new one the same way):

```bash
curl -s https://<vercel-domain>/cpp-api/me -H "Authorization: Bearer $TOKEN"
```

Expected: `{"data":{"id":"<that user's uuid>"},"success":true}`.

That request went: your terminal → Vercel → rewrite → Fly → JWT verified → Supabase Postgres as that user → `auth.uid()` → back. 🎉 Sub-project 1 is done.

Also check the failure path: without the header you should get `{"error":"Not authenticated","success":false}`.

If something fails, paste the error and the relevant `fly logs` lines (without tokens or secrets) and I'll help.

---

## Step 6 — Commit (only if `fly.toml` changed)

If you changed the app name in Step 2:

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
git add backend/fly.toml
git commit -m "chore(backend): set Fly app name" -- backend/fly.toml
```

If `fly.toml` is unchanged (`git status` doesn't list it), skip this.

---

## Handy Fly commands for later

| Command                  | What it does                                  |
| ------------------------ | --------------------------------------------- |
| `fly logs`               | Live server logs (`[http]`, `[auth]`, …)      |
| `fly status`             | Machines and their state                      |
| `fly secrets list`       | Secret names (never values)                   |
| `fly deploy`             | Build and ship the current `backend/`         |
| `fly scale count 1`      | Keep one machine always on (no cold starts, costs more) |
