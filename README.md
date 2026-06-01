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
| **Wipe** | Runs `nwipe` (HDD/Linux) or walks you through Apple's erase checklist |
| **Recycle** | Logs the device as recycled; generates a PDF decommission certificate |

Job output streams live to your browser via Server-Sent Events. Disconnect and reconnect — the full log replays from disk.

---

## Requirements

**Runtime**
- Python 3.11+
- Node.js 18+ (frontend dev only; production serves compiled static files)

**External tools** (install what you need; the app checks on startup)

| Tool | Used for | macOS | Linux |
|---|---|---|---|
| `restic` | Migrate, Verify | `brew install restic` | `apt install restic` |
| `czkawka_cli` | Catalog (fast hashing) | `brew install czkawka` | [GitHub releases](https://github.com/qarmin/czkawka/releases) |
| `jdupes` | Catalog (fallback) | `brew install jdupes` | `apt install jdupes` |
| `ideviceinfo` | iOS extraction | `brew install libimobiledevice` | `apt install libimobiledevice-utils` |
| `nwipe` | Wipe (HDD, Linux only) | — | `apt install nwipe` |

Missing tools are flagged in the UI health screen — the app starts and runs fine without them until you reach the stage that needs them.

---

## Quick start

```bash
git clone https://github.com/jdmacleod/the-decommissioner.git
cd the-decommissioner/backend

# Create venv and install deps
uv venv --python 3.11 .venv
uv pip install -r requirements.txt

# Start the backend (runs migrations automatically on first launch)
make dev-backend
```

Open [http://localhost:8000/docs](http://localhost:8000/docs) for the auto-generated API docs.

For the full UI with hot-reload, also run the frontend dev server:

```bash
# In a second terminal
make dev-frontend   # http://localhost:5173
```

---

## Configuration

All configuration is via environment variables (or a `.env` file in `backend/`):

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `~/.decommissioner` | SQLite DB, job logs, iOS staging dirs |
| `HOST` | `127.0.0.1` | Bind host |
| `PORT` | `8000` | Bind port |
| `LOG_LEVEL` | `info` | Uvicorn log level |

**Restic password** — the app never stores your restic password. Set the name of the environment variable that holds it when configuring a storage target (default: `RESTIC_PASSWORD`). Export it before starting the service:

```bash
export RESTIC_PASSWORD=your-repo-password
make dev-backend
```

---

## Docker

```bash
docker-compose up --build
```

The backend and a nginx frontend are started together. The SQLite database and job logs live on a named volume (`decommissioner_data`).

---

## Development

```bash
make dev-backend    # FastAPI on :8000 with --reload
make dev-frontend   # Vite on :5173 with HMR (proxies /api to :8000)
make build          # Compile frontend → backend/app/static/ (served by FastAPI)
make test           # pytest
make lint           # ruff + eslint
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

## Architecture notes

**Log file is the SSE source of truth.** Every byte from a subprocess is written to `{DATA_DIR}/logs/job_{id}.log` before being yielded to clients. The SSE endpoint tails this file. A client that disconnects and reconnects gets a full replay — no in-memory buffer needed.

**Passwords never touch the database.** `StorageTarget.restic_password_env` stores the *name* of an environment variable. The actual password lives in your shell environment and is passed through to `restic` subprocess calls.

**Device stage is a forward-only FSM.** A failed job leaves the device at its last successful stage; it never rolls back beyond that. Re-cataloging is the one exception — it resets to `cataloged` but never to `registered`.

**FileEntry is the central table.** Cataloging creates rows, duplicate analysis groups them, migration tags them `migrated`, verification confirms them. Everything downstream queries this table.

---

## License

MIT
