# Task 6 — Docker image, Fly config, and the local dev script (type-it-yourself guide)

**Goal:** package the server so it can run anywhere. A Docker image builds the release binary on Linux and ships it in a small runtime image; `fly.toml` tells Fly.io how to run it; `.env.example` documents the env vars; and `npm run dev:api` starts the C++ server locally next to `npm run dev`.

No C++ in this task and no unit tests — verification is "build the image and curl it".

All paths below are relative to `/Users/dhruvchaudhari/Codes/Trade-AI/`. The `backend/` files already exist (empty) — open each one and type the content in.

| #   | File                    | What it is                                                     |
| --- | ----------------------- | -------------------------------------------------------------- |
| 1   | `backend/.dockerignore` | What **not** to send to Docker when building                   |
| 2   | `backend/Dockerfile`    | Two-stage build: compile on full Debian, run on slim Debian    |
| 3   | `backend/fly.toml`      | Fly.io app config: port, health check, machine size            |
| 4   | `backend/.env.example`  | Template for `backend/.env` (no real secrets — this is committed) |
| 5   | `package.json` (edit)   | Add the `dev:api` script                                       |

---

## File 1 — `backend/.dockerignore`

```
build/
vcpkg_installed/
.env
```

**How to read it**

- When you run `docker build`, Docker first copies the whole folder (the "build context") into the builder. `build/` is gigabytes of Mac object files that are useless on Linux; `.env` contains your real secrets and must **never** end up inside an image.

---

## File 2 — `backend/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM debian:trixie AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake ninja-build git curl zip unzip tar pkg-config \
      autoconf autoconf-archive automake libtool bison flex perl python3 linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/microsoft/vcpkg /opt/vcpkg \
    && /opt/vcpkg/bootstrap-vcpkg.sh -disableMetrics
ENV VCPKG_ROOT=/opt/vcpkg
# Needed on arm64 Linux hosts; harmless on x86_64.
ENV VCPKG_FORCE_SYSTEM_BINARIES=1

WORKDIR /src
# Dependencies first so they stay cached across source-only changes.
COPY vcpkg.json ./
RUN /opt/vcpkg/vcpkg install --x-install-root=/src/vcpkg_installed
COPY . .
RUN cmake --preset release -DVCPKG_INSTALLED_DIR=/src/vcpkg_installed -DTRADEAI_BUILD_TESTS=OFF \
    && cmake --build --preset release

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home app
COPY --from=builder /src/build/release/tradeai_api /usr/local/bin/tradeai_api
USER app
EXPOSE 8080
CMD ["/usr/local/bin/tradeai_api"]
```

**How to read it**

- **Two stages.** `FROM debian:trixie AS builder` has compilers, vcpkg and every library's source (~several GB). The second `FROM debian:trixie-slim` starts fresh and copies in *only* the finished binary. The final image is small and contains no compilers or source code.
- Why Debian **trixie**: it ships GCC 14, which has full C++23 support (`std::expected`). Older Debian doesn't.
- The long `apt-get install` list — tools vcpkg needs to build libraries like libpq and OpenSSL from source (autotools, bison, flex, perl…). `--no-install-recommends` and `rm -rf /var/lib/apt/lists/*` keep layers smaller.
- **Layer caching trick.** `COPY vcpkg.json` → `vcpkg install` → *then* `COPY . .`. Docker caches each step; if only your `.cpp` files change, it reuses the cached (20-minute) dependency step and only recompiles your code.
- `-DVCPKG_INSTALLED_DIR=/src/vcpkg_installed` — tells CMake to use the libraries we already installed in the cached layer instead of installing them again.
- `-DTRADEAI_BUILD_TESTS=OFF` — the option from Task 1's `CMakeLists.txt`; no GoogleTest in production.
- `ca-certificates` in the runtime image — needed so the server can make HTTPS calls (Supabase JWKS) and verify TLS to Postgres.
- `useradd --system ... app` + `USER app` — run as an unprivileged user, not root. If the process were ever compromised, it can't modify the system.
- The binary is linked **statically** against the vcpkg libraries (vcpkg's default on Linux), which is why the runtime image doesn't need libpq, OpenSSL, etc. installed.

### ✋ Checkpoint — build the image and smoke-test it

Needs Docker Desktop running. **The first build compiles every dependency and takes about 20 minutes** — later builds are much faster thanks to caching.

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI/backend
docker build -t tradeai-api .
docker run --rm -d --name tradeai-api-smoke -p 8080:8080 \
  -e DATABASE_URL="host=127.0.0.1 port=1" -e SUPABASE_URL=https://example.supabase.co tradeai-api
curl -s localhost:8080/healthz                                 # {"data":{"status":"ok"},"success":true}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/me     # 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/readyz # 503 (no DB inside container)
docker stop tradeai-api-smoke
```

- `-d` runs the container in the background; `--rm` deletes it when stopped; `-p 8080:8080` maps the port to your Mac.
- `DATABASE_URL="host=127.0.0.1 port=1"` — deliberately unreachable (inside the container, 127.0.0.1 is the container itself). So `/readyz` returning **503** is the correct, expected answer here.
- If `docker run` exits immediately, see why with `docker logs tradeai-api-smoke` (run it before the container is removed, or drop `--rm`).

---

## File 3 — `backend/fly.toml`

```toml
app = "tradeai-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/healthz"
    timeout = "5s"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

**How to read it**

- `app` — the Fly app name; it becomes `https://tradeai-api.fly.dev`. If the name is taken in Task 8 you'll change it here.
- `primary_region = "iad"` — Ashburn, Virginia. Pick the region closest to your **Supabase database** (every request talks to it), not closest to you.
- `internal_port = 8080` — the port our server listens on (the `PORT` default). Fly terminates HTTPS and forwards to it; `force_https` redirects plain HTTP.
- `auto_stop_machines` / `auto_start_machines` / `min_machines_running = 0` — the machine sleeps when idle and wakes on the next request. Cheapest option; the trade-off is a short cold start on the first request after idling.
- `[[http_service.checks]]` — Fly calls `/healthz` every 30 s; that's why `/healthz` must not depend on the database (Task 5).
- `[[vm]]` — the smallest sensible machine: 1 shared CPU, 512 MB RAM.

---

## File 4 — `backend/.env.example`

```bash
PORT=8080
# Supabase → Connect → Session pooler (port 5432). The transaction pooler (6543) also works.
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://<project-ref>.supabase.co
# Only for projects still signing with the legacy HS256 secret (Supabase → Project Settings → JWT Keys).
SUPABASE_JWT_SECRET=
ALLOWED_AUDIENCE=authenticated
DB_POOL_SIZE=8
HTTP_THREADS=32
```

**How to read it**

- This file **is committed**, so it contains only placeholders. Your real values go in `backend/.env`, which is git-ignored (`.env*` in the root `.gitignore`; `.env.example` is explicitly un-ignored).
- `DATABASE_URL` — use Supabase's **pooler** URL, not the direct `db.<ref>.supabase.co` one. The direct host is IPv6-only unless you pay for Supabase's IPv4 add-on, while the pooler works over IPv4 from anywhere (your Mac, Docker, Fly). This is also why the code never uses server-side prepared statements (the transaction pooler doesn't support them).
- `SUPABASE_JWT_SECRET` — leave empty unless your project still signs tokens with the legacy shared secret. Check in Supabase → Project Settings → JWT Keys.
- `DB_POOL_SIZE=8` — max Postgres connections this server opens. Keep it well under your Supabase plan's limit.
- `HTTP_THREADS=32` — Crow worker threads. More threads than DB connections is fine: requests that don't hit the DB (`/healthz`, compute-only routes later) don't need one.

---

## File 5 — add `dev:api` to the root `package.json`

Open `/Users/dhruvchaudhari/Codes/Trade-AI/package.json`. In `"scripts"`, directly after the `"dev"` line, add:

```json
    "dev:api": "cd backend && cmake --preset debug && cmake --build --preset debug && set -a && . ./.env && set +a && ./build/debug/tradeai_api",
```

So the top of `scripts` reads:

```json
  "scripts": {
    "dev": "next dev -H 0.0.0.0",
    "dev:api": "cd backend && cmake --preset debug && cmake --build --preset debug && set -a && . ./.env && set +a && ./build/debug/tradeai_api",
    "build": "next build",
```

**How to read it**

- `cmake --preset debug && cmake --build --preset debug` — configure (fast when nothing changed) and rebuild.
- `set -a && . ./.env && set +a` — `set -a` makes every variable defined from now on *exported*; `. ./.env` loads the file; `set +a` turns that off. Net effect: everything in `backend/.env` becomes an environment variable for the server. (`.` is the portable spelling of `source`.)
- It needs `VCPKG_ROOT` in your environment. If you haven't already, add `export VCPKG_ROOT=$HOME/vcpkg` to your `~/.zshrc` so you don't have to type it each time.

### ✋ Checkpoint — run it against your real Supabase

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
cp backend/.env.example backend/.env
# now open backend/.env and fill in DATABASE_URL and SUPABASE_URL with your real values
npm run dev:api
```

In a second terminal:

```bash
curl -s localhost:8080/readyz
```

Expected: `{"data":{"status":"ready"},"success":true}` — your C++ server is talking to your real Supabase database. Stop the server with `Ctrl+C`.

- Getting `503` → the server can't reach the DB. Look at the `[readyz]` line in the server's terminal; usually a typo in the password or using the direct (non-pooler) host.
- Don't paste your `.env` contents into chat; describe the error instead.

If something fails, paste the error (without secrets) and I'll help.

## Commit

```bash
cd /Users/dhruvchaudhari/Codes/Trade-AI
FILES="backend/Dockerfile backend/.dockerignore backend/fly.toml backend/.env.example package.json"
git add $FILES
git commit -m "build(backend): Dockerfile, Fly config, dev:api script" -- $FILES
```

(`backend/.env` is git-ignored, so it can't sneak in. Before committing, `git diff --cached package.json` should show only the one added line.)
