# KubeLearn

A visual, interactive way to learn Kubernetes. No real cluster: a small educational
simulation of Kubernetes' *observable* behavior, rendered as a living cluster that
reacts to what you do.

## Running it

Requirements: Node 22+, Java 21, Docker.

```bash
npm install
npm run dev        # API on :8080 (starts Postgres + Mailpit via Docker) and web on :5180
```

Open http://localhost:5180. Sign-in emails land in **Mailpit** at http://localhost:8025.
The web app works fully without the API — progress just stays on the device.

```bash
npm test           # shared (TS) + web (Vitest) + API (JUnit, Testcontainers)
npm run fixtures   # regenerate the cross-language merge fixtures after changing merge rules
```

## Lessons

| # | Lesson | What you see happen |
|---|---|---|
| 1 | Self-healing | Delete a Pod; the ReplicaSet notices `Desired ≠ Actual` and replaces it |
| 2 | Scaling | Drag replicas first, learn `kubectl scale` second |
| 3 | Services & traffic | Requests flow only to Ready Pods; a dying Pod drops out of the endpoints |
| 4 | Labels & selectors | Relabel Pods in and out of a Service — and out of their ReplicaSet (orphaning, adoption) |
| 5 | Debugging: no endpoints | A Service selecting `app=api` while Pods say `app=backend` — find it, fix it |
| 6 | Failures & rollbacks | A broken v1.5 crash-loops, the rollout stalls safely, `rollout undo` restores v1.4 |
| 7 | ConfigMaps | A missing ConfigMap stalls the rollout (`CreateContainerConfigError`); a changed one reaches no running Pod until `rollout restart` |
| 8 | Secrets | v1.5 from lesson 6 fixed forward with a Secret — and `-o jsonpath … \| base64 -d` shows it was never hidden |
| 9 | Probes | v1.6 freezes after a while: readiness takes it out of the Service but only a liveness probe restarts it — and `rollout undo` would drop the probe |
| 10 | Resources & autoscaling | Without requests the HPA reads `<unknown>`; with them, a load generator scales it up — and down only after the stabilization window |
| 11 | Jobs | 5 report tasks, 2 at a time, end in `Completed` and are never replaced; a failing one retries with back-off until `BackoffLimitExceeded` |

Lessons live in `src/lessons/` as data: a starting cluster (`setup`), manifests in the
terminal's directory (`files`), objectives as predicates over the simulated state, and a
completion story built from the cluster's own event history. Each lesson has its own URL
(`#/scaling`); ids are declared once in `packages/shared/catalog.json`.

Every surface — stage, terminal, timeline, inspector, narration — renders the same simulated state.

## Architecture

```
apps/web/           React app — the simulation runs entirely here
  src/sim/          the simulated cluster (pure TS)
  src/progress/     local-first progress + sync engine
  src/auth/         session state, sign-in flows
apps/api/           Spring Boot 4 (Java 21): accounts and progress, nothing else
packages/shared/    catalog.json (lesson ids) + the progress model, shared by both
```

### Accounts & sync

- **Passwordless.** A sign-in link by email (Spring Security one-time tokens, stored only
  as SHA-256, consumed atomically, 10 min, single use). The link opens the web app, which
  asks for one click before spending the token — so mail scanners can't burn it.
  **GitHub** sign-in is enabled when `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are set; it
  links accounts only by GitHub's *verified* email, and keeps no GitHub token.
- **Sessions** are cookies (`kl_session`: httpOnly, SameSite=Lax, Secure in prod) stored in
  Postgres via Spring Session — revocable, survive restarts. Signing in rotates the session
  id and the CSRF token; deleting an account signs it out on every device.
- **CSRF** double-submit cookie on every write, including the sign-in endpoints. Errors are
  RFC 9457 problems with a stable `code`.
- **Local-first progress.** Every change is saved on the device first; when signed in the
  whole document is PUT and the server returns the merge. Progress only grows (objectives:
  union · completion: earliest · best time: min · resume point: latest), so the merge is
  commutative, associative and idempotent: retries are safe and two devices can't conflict.
  Java and TypeScript implement it separately and are checked against the same 200+
  generated fixtures, plus property tests on both sides.
- Signing in uploads what you did while signed out. Signing out forgets the device's copy
  (it's in the account). After syncing, an untouched lesson resumes where you left off.

### Deploying

`deploy/` runs the whole thing on one server with Docker: **Caddy** (serves the web app,
proxies `/api`, gets the HTTPS certificate) → **API** → **Postgres**.

```bash
cd deploy
cp .env.example .env     # domain, Postgres password, SMTP
docker compose up -d --build
```

The domain's DNS must point to the server, with ports 80 and 443 open. To try the stack
locally, set `DOMAIN=localhost`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, the alternative
ports in `.env.example`, and add `--profile local` (emails at http://localhost:8025).

Caddy sets the security headers (strict CSP, HSTS), caches hashed assets forever and
revalidates `index.html`. CI (`.github/workflows/ci.yml`) runs every test and builds both images.

**Backups.** The `backup` service dumps Postgres at start and every 24h into `deploy/backups/`,
deleting dumps older than 14 days (the privacy page promises that window — change both
together). That folder is on the same disk as the database: copy it off the server too
(e.g. `restic` or `rclone` to object storage, with the same retention). To restore:

```bash
docker compose exec -T postgres pg_restore -U kubelearn -d kubelearn --clean --if-exists \
  --single-transaction < backups/kubelearn-<date>.dump
```

**Errors and uptime.** Browser errors are posted to `/api/client-errors` and written to the
API log, with no IP or account: `docker compose logs api | grep client-error`. Point an
uptime monitor (UptimeRobot, Better Stack, …) at `https://$DOMAIN/api/health`.

**Privacy.** `/privacidade` describes exactly what is stored; `OPERATOR_NAME` and
`CONTACT_EMAIL` fill in who answers for it. Signed-in users can download everything about
them (`GET /api/me/export`) or delete it. When storage changes, update that page.

### Production configuration

The compose file already does this. Running the API another way: activate the `prod`
profile (`SPRING_PROFILES_ACTIVE=prod`, the image's default) and set:

| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | the origin users see, e.g. `https://kubelearn.example` — links and redirects use it |
| `SPRING_DATASOURCE_URL`, `_USERNAME`, `_PASSWORD` | Postgres (Flyway migrates on start) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | outgoing mail for sign-in links |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | optional; callback URL is `$PUBLIC_URL/login/oauth2/code/github` |

The web app and `/api`, `/oauth2`, `/login/oauth2` must be served from the same origin
(a reverse proxy in front of both, as Vite's proxy does in development). Rate limits are
in-memory, so they hold per instance.

### Simulation

- **Simulated time.** Every controller step is a scheduled task with a human label — that's
  what makes Pause, Step (`.`), speed and "next: …" possible.
- **Effects are part of the model.** The engine emits `pulse` (intent flowing down an
  ownership chain) and `ping` (something just changed); the stage plays them.
- **Layout is owned by the sim** (`Pod.slot`), so a deleted Pod leaves a visible hole
  that its replacement fills.
- **Custom stage (Motion + SVG), not React Flow**: layout is engine-driven and edges must
  follow spring-animated nodes frame by frame.
- Pacing is stretched on purpose (a heal takes ~4s); the UI says real clusters are faster.
- Traffic is a picture, not real requests: particles routed round-robin to the endpoints
  the simulation computed.

## Shortcuts

`Space` pause/resume · `.` step · `r` restart lesson · `/` focus terminal ·
`Ctrl/⌘ K` palette · `Delete` delete selected Pod · `Esc` deselect / stop `-w`

## Next

ConfigMaps/Secrets (the fix for v1.5's missing `DATABASE_URL`), probes as an editable
concept, Jobs, a better small-screen layout, a deploy recipe (container image + proxy).
