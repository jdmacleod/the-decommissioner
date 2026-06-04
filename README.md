# the-decommissioner

A self-hosted service that guides you through decommissioning old hardware — cataloging files, migrating keepers to a deduplicated backup target, wiping drives, and logging devices for recycling.

Runs on **macOS and Linux**. Wraps proven CLI tools ([restic](https://restic.net), [czkawka](https://github.com/qarmin/czkawka), [nwipe](https://github.com/martijnvanbrummelen/nwipe)) rather than reimplementing their logic.

---

## What it does

Each device moves through a forward-only workflow:

```
Register → Catalog → Review duplicates → Migrate → Verify → Wipe → Recycle
```

| Stage | What happens |
|---|---|
| **Catalog** | Walks all files; computes SHA-256 hashes; detects duplicates via czkawka |
| **Review** | You mark which files to keep; auto-resolver handles obvious duplicates |
| **Migrate** | Runs `restic backup` to your chosen repository (local, SFTP, or S3) |
| **Verify** | Runs `restic check` and confirms every cataloged file is in the snapshot |
| **Wipe** | Runs `nwipe` (HDD/Linux), Apple's erase checklist, or a network-share disconnect checklist |
| **Recycle** | Logs the device as recycled; generates a PDF decommission certificate |

Job output streams live to your browser via Server-Sent Events. Disconnect and reconnect — the full log replays from disk.

---

## Requirements

**Runtime**
- Python 3.11+
- Node.js 18+ (needed once to build the frontend; not required at runtime)

**External tools** (install what you need; the app checks on startup)

| Tool | Used for | macOS | Linux |
|---|---|---|---|
| `restic` | Migrate, Verify | `brew install restic` | `apt install restic` |
| `czkawka_cli` | Catalog (fast hashing) | `brew install czkawka` | [GitHub releases](https://github.com/qarmin/czkawka/releases) |
| SMB/NFS/AFP | Network volumes (source) | Connect via Finder → Go → Connect to Server | `mount -t nfs`/`mount -t cifs` |
| `jdupes` | Catalog (fallback) | `brew install jdupes` | `apt install jdupes` |
| `ideviceinfo` | iOS extraction | `brew install libimobiledevice` | `apt install libimobiledevice-utils` |
| `nwipe` | Wipe (HDD, Linux only) | — | `apt install nwipe` |

Missing tools are flagged in the UI health screen — the app starts and runs fine without them until you reach the stage that needs them.

---

## Quick start

```bash
git clone https://github.com/jdmacleod/the-decommissioner.git
cd the-decommissioner

# Copy and edit configuration
cp .env.example .env
# → set RESTIC_PASSWORD (and any other variables) in .env

# Install backend dependencies
cd backend
uv venv --python 3.11 .venv
uv pip install -r requirements.txt

# Build the frontend (one-time; repeat after pulling frontend changes)
cd ../frontend
npm install
npm run build
```

Then start the app:

```bash
cd ../backend
source .venv/bin/activate
uvicorn app.main:app --port 8000
```

Open [http://localhost:8000](http://localhost:8000). The backend serves the compiled frontend and the API from the same port. Migrations run automatically on first launch.

> **Shortcut:** if `make` is available, `make dev-backend` from `backend/` is equivalent to the uvicorn command above.

---

## Configuration

Copy `.env.example` to `.env` in the project root and edit as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `~/.decommissioner` | SQLite DB, job logs, iOS staging dirs |
| `HOST` | `127.0.0.1` | Bind host (`0.0.0.0` for LAN access) |
| `PORT` | `8000` | Bind port |
| `LOG_LEVEL` | `info` | Uvicorn log level (`debug`, `info`, `warning`, `error`) |
| `RESTIC_PASSWORD` | *(required)* | Password for the default restic repository |

**Restic password** — the app never stores your restic password. When you add a storage target in the UI you specify the *name* of the environment variable that holds the password (default: `RESTIC_PASSWORD`). The value is passed through to `restic` at runtime and never written to the database. To use multiple repositories with different passwords, define multiple variables (e.g. `RESTIC_PASSWORD_OFFSITE`) and set the matching name in each storage target's settings.

---

## Documentation

| Document | Type | What's in it |
|---|---|---|
| [Tutorial: decommission your first drive](docs/tutorial-first-decommission.md) | Tutorial | End-to-end walkthrough from install to certificate |
| [Keyboard triage](docs/keyboard-triage.md) | How-to + Reference | J/K/Space shortcuts, path heuristic, receipt screen |
| [How to configure storage targets](docs/howto-storage-targets.md) | How-to | Local, SFTP, and S3 setup with troubleshooting |
| [Stage and status reference](docs/reference-stages.md) | Reference | All stages, file statuses, job types, device types |
| [Architecture explanation](docs/explanation-architecture.md) | Explanation | Why the FSM is one-way, why the log file drives SSE, why passwords stay in env vars |

Design documents (internal spec, not end-user docs):

| Document | Contents |
|---|---|
| [docs/data-models.md](docs/data-models.md) | SQLModel table definitions, enumerations, indexes |
| [docs/subprocess-runner.md](docs/subprocess-runner.md) | Async runner, SSE streaming, job lifecycle |
| [docs/ui-design.md](docs/ui-design.md) | UI layout, page components, API summary |

---

## Development

For frontend hot-reload during development, run the backend and frontend dev servers in separate terminals:

```bash
make dev-backend    # FastAPI on :8000 with --reload
make dev-frontend   # Vite on :5173 with HMR (proxies /api to :8000)
```

Open [http://localhost:5173](http://localhost:5173) while developing the frontend. The compiled build at `:8000` is unaffected until you run `make build` again.

Other useful targets:

```bash
make build          # Compile frontend → backend/app/static/ (served by FastAPI)
make test           # pytest
make lint           # ruff + eslint
make check          # full quality gate: format, lint, typecheck, tests, coverage
make install-deps   # pip + npm + system tool check
```

### Project layout

```
backend/
  app/
    api/          # FastAPI routers (devices, jobs, dependencies, …)
    core/         # config, database, runner, job_factory, deps checker
    engines/      # one module per external tool (catalog, migrate, wipe, …)
    models/       # SQLModel tables + Pydantic schemas
  alembic/        # migrations (auto-run at startup)
frontend/
  src/
    pages/        # Dashboard, AddDevice, DeviceWizard, Settings
    stages/       # one component per workflow stage
    components/   # JobLog (SSE), StageProgress, DeviceCard, …
    lib/          # api.ts, store.ts (Zustand)
    types/        # TypeScript types matching backend schemas
docs/             # design documents (authoritative spec)
```

### Adding a new engine

1. Create `backend/app/engines/<name>.py` with an `async def run_<name>(job_id, device, session, runner)` function.
2. Call `runner.run(job_id, cmd)` — it handles logging, SSE streaming, and job status transitions.
3. Add the job trigger to `backend/app/api/devices.py` (FSM validation + `asyncio.create_task`).
4. Add the corresponding stage component in `frontend/src/stages/`.

See `docs/subprocess-runner.md` for the full engine pattern and data-flow diagram.

---

## Server deployment (Docker)

Docker is provided for deploying to a Linux server where you want the app available persistently without managing a Python environment on the host.

Two services are defined:

| Service | Image | Port | Notes |
|---|---|---|---|
| `backend` | built from `./backend/Dockerfile` | 8000 | FastAPI + uvicorn; SQLite on a named volume |
| `frontend` | `nginx:alpine` | 3000 | Serves pre-compiled static files; proxies `/api` to backend |

```bash
export RESTIC_PASSWORD=your-repo-password
docker-compose up --build
```

The UI is then available at [http://localhost:3000](http://localhost:3000).

The SQLite database and job logs are persisted on a named volume (`decommissioner_data`).

### Device access limitations

Because the backend runs inside a Linux container, several hardware features require extra configuration or do not work at all:

| Feature | Limitation | Workaround |
|---|---|---|
| **Drive wiping** (`nwipe`) | Needs the block device passed explicitly | Add `--device /dev/sdX` to the backend service, or use `--privileged` (grants full host device access) |
| **iOS extraction** | Docker Desktop (macOS) has no USB passthrough | Not supported in Docker on macOS; use native install |
| **Volume scan / serial detection** | `diskutil` and `lsblk` see container-internal mounts, not the host | `/Volumes` is bind-mounted read-only (`/Volumes:/Volumes:ro`); serial numbers return `null` for volumes mounted inside Docker |
| **macOS-specific tools** | Container is always Linux; `sys.platform == "darwin"` is always false | Some heuristics fall back gracefully; others produce empty results |

**When to use Docker:** a dedicated Linux server or NAS that manages drives directly (e.g., `/dev/sdb` is visible to the container). Pass `--device /dev/sdX` for each drive you intend to wipe.

**When to use native:** a macOS or Linux workstation where you're connecting drives, phones, or laptops directly. The app runs on the real host, sees the real devices, and all platform-specific tools work as designed.

---

## Architecture notes

**Log file is the SSE source of truth.** Every byte from a subprocess is written to `{DATA_DIR}/logs/job_{id}.log` before being yielded to clients. The SSE endpoint tails this file. A client that disconnects and reconnects gets a full replay — no in-memory buffer needed.

**Passwords never touch the database.** `StorageTarget.restic_password_env` stores the *name* of an environment variable. The actual password lives in your shell environment and is passed through to `restic` subprocess calls.

**Device stage is a forward-only FSM.** A failed job leaves the device at its last successful stage; it never rolls back beyond that. Re-cataloging is the one exception — it resets to `cataloged` but never to `registered`.

**FileEntry is the central table.** Cataloging creates rows, duplicate analysis groups them, migration tags them `migrated`, verification confirms them. Everything downstream queries this table.

---

## License

MIT
