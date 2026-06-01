# the-decommissioner

An open source self-hosted service that guides users through decommissioning
old hardware — cataloging files, migrating keepers to a deduplicated storage
target, wiping drives, and recycling devices.

Runs on **macOS and Linux**. Wraps proven CLI tools (restic, czkawka, nwipe)
rather than reimplementing their logic.

---

## Design Documents

All design decisions are captured in `docs/`. Read these before writing any code.

| File | Contents |
|---|---|
| `docs/data-models.md` | All SQLModel table definitions, enumerations, indexes, and migration strategy |
| `docs/subprocess-runner.md` | Async runner design, SSE streaming, log file strategy, job lifecycle, engine pattern, cancellation |
| `docs/ui-design.md` | Full UI layout, all page/stage components, API summary, JobLog and StageProgress component specs |

---

## Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend language | Python 3.11+ | Best async subprocess tooling; broad contributor base |
| Web framework | FastAPI (async) | Native SSE/streaming, auto OpenAPI, Pydantic integration |
| ORM / schema | SQLModel | Merges SQLAlchemy tables with Pydantic — one model, two uses |
| Database | SQLite | Zero-dependency; sufficient for single-user orchestration service |
| Migrations | Alembic | `alembic upgrade head` runs automatically at startup |
| Task execution | asyncio background tasks | No broker needed; jobs are subprocess-based, not compute-heavy |
| Streaming | Server-Sent Events (SSE) | One-directional log streaming; simpler than WebSockets |
| Frontend | React + Vite + TypeScript | Large ecosystem for open source contributors |
| Styling | Tailwind + shadcn/ui | Unstyled primitives you own; no locked-in library |
| Data fetching | TanStack Query | Cache invalidation and polling for job status |
| Tables | TanStack Table + Virtual | Virtualized for 100k+ file manifests |
| Client state | Zustand | Lightweight; wizard step, selected device |
| Routing | React Router v6 | Standard |
| Deployment | Docker Compose (optional) | Backend + nginx frontend; SQLite on a named volume |
| Native install | `pip install the-decommissioner` | Single command; uvicorn serves API + static frontend |

---

## Project Structure

```
the-decommissioner/
├── CLAUDE.md                        ← you are here
├── docs/
│   ├── data-models.md
│   ├── subprocess-runner.md
│   └── ui-design.md
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app init, lifespan, static files, CORS
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── devices.py           # CRUD + /detect-ios + /jobs trigger
│   │   │   ├── file_entries.py      # GET (paginated/filtered) + PATCH bulk
│   │   │   ├── duplicate_groups.py  # GET + PATCH + auto-resolve
│   │   │   ├── jobs.py              # GET + SSE stream + cancel
│   │   │   ├── storage_targets.py   # CRUD + test + init
│   │   │   ├── snapshots.py         # GET per device
│   │   │   ├── dependencies.py      # GET + re-check
│   │   │   └── certificates.py      # GET PDF
│   │   ├── engines/
│   │   │   ├── catalog.py           # wraps czkawka_cli (fallback: jdupes)
│   │   │   ├── ios.py               # wraps ideviceinfo + ifuse/AFC
│   │   │   ├── migrate.py           # wraps restic backup
│   │   │   ├── verify.py            # wraps restic check + restic snapshots
│   │   │   └── wipe.py              # wraps nwipe / hdparm / Apple checklist logic
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── enums.py             # all Enum classes
│   │   │   ├── device.py
│   │   │   ├── file_entry.py
│   │   │   ├── duplicate_group.py
│   │   │   ├── job.py
│   │   │   ├── storage_target.py
│   │   │   ├── snapshot.py
│   │   │   └── dependency.py
│   │   └── core/
│   │       ├── config.py            # settings from env vars (DATA_DIR, etc.)
│   │       ├── database.py          # engine, session factory, create_tables()
│   │       ├── runner.py            # SubprocessRunner class
│   │       ├── job_factory.py       # create_job() helper
│   │       └── deps.py              # dependency checker + FastAPI Depends helpers
│   ├── alembic/
│   │   └── versions/
│   ├── alembic.ini
│   ├── requirements.txt
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                  # router setup
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx        # kanban by stage cluster
│   │   │   ├── DeviceWizard.tsx     # stage progress + active stage component
│   │   │   ├── AddDevice.tsx
│   │   │   └── Settings.tsx         # storage target + health check
│   │   ├── stages/                  # one component per DeviceStage cluster
│   │   │   ├── CatalogStage.tsx
│   │   │   ├── FileBrowser.tsx      # virtualized TanStack Table
│   │   │   ├── DuplicateResolver.tsx
│   │   │   ├── MigrateStage.tsx
│   │   │   ├── VerifyStage.tsx
│   │   │   ├── WipeStage.tsx        # renders HDD or Apple checklist variant
│   │   │   └── RecycleStage.tsx
│   │   ├── components/
│   │   │   ├── JobLog.tsx           # SSE log stream viewer
│   │   │   ├── StageProgress.tsx    # stage indicator bar
│   │   │   ├── DeviceCard.tsx       # dashboard kanban card
│   │   │   ├── DeviceSidebar.tsx
│   │   │   └── DependencyBadge.tsx
│   │   ├── lib/
│   │   │   ├── api.ts               # typed fetch wrappers for all endpoints
│   │   │   ├── stream.ts            # EventSource wrapper hook (useJobStream)
│   │   │   └── store.ts             # Zustand store
│   │   └── types/
│   │       └── api.ts               # TypeScript types matching backend schemas
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── docker-compose.yml
├── Makefile
└── README.md
```

---

## Key Architectural Decisions

### Engines are thin subprocess wrappers
Each engine builds a command list and calls `runner.run(job_id, cmd)`. The engine may
inspect yielded lines (e.g., to parse progress percentages), but all I/O plumbing is
in the runner. Do not re-implement hashing, deduplication, or backup logic.

### Log file is the SSE source of truth
The runner writes every subprocess output byte to `{DATA_DIR}/logs/job_{id}.log`
before yielding. The SSE endpoint tails this file. This decouples client connections
from the runner coroutine and gives reconnecting clients a full replay at no extra cost.
Never use an in-memory buffer for log lines.

### FileEntry is the central table
Everything flows through `FileEntry`: cataloging creates rows, duplicate analysis groups
them, migration tags them `migrated`, verification confirms them. The API's file browser,
duplicate resolver, and verify diff all query this table. Keep its indexes maintained.

### Device stage is a forward-only FSM
`device.stage` never moves backward (except to allow re-cataloging, which resets to
`cataloged` but never to `registered`). Stage transitions are enforced in the API layer
by checking the current stage before accepting a job trigger. A failed job does not
change the device stage — it leaves a `Job` row with `status=failed` and the device
at its last successful stage.

### Passwords never touch the DB
`StorageTarget.restic_password_env` holds the name of an environment variable.
The actual password lives in the shell environment. The app passes the env through
to `restic` subprocess calls. Document this prominently in README.

### iOS extraction goes to a staging directory
iOS devices can't be read directly as a filesystem by the catalog engine. The `ios`
engine extracts files to `{DATA_DIR}/staging/device_{id}/` using libimobiledevice,
then sets `device.staging_path`. The catalog engine uses `staging_path` as its source
when `source_path` is None. After cataloging, the staging dir can optionally be cleaned
up to save space.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `~/.decommissioner` | Root for SQLite DB, logs, staging dirs |
| `HOST` | `127.0.0.1` | Uvicorn bind host |
| `PORT` | `8000` | Uvicorn bind port |
| `RESTIC_PASSWORD` | *(required)* | Default restic repo password env var name |
| `LOG_LEVEL` | `info` | Uvicorn log level |

---

## First Implementation Steps (suggested order for v0.1)

1. `backend/app/core/config.py` — Settings class reading from env
2. `backend/app/core/database.py` — SQLite engine, session factory
3. `backend/app/models/` — all model files (copy from docs/data-models.md)
4. Alembic init + first migration
5. `backend/app/core/runner.py` — SubprocessRunner (copy from docs/subprocess-runner.md)
6. `backend/app/core/job_factory.py`
7. `backend/app/engines/catalog.py` — czkawka wrapper
8. `backend/app/api/devices.py` — basic CRUD
9. `backend/app/api/jobs.py` — status GET + SSE stream
10. `backend/app/main.py` — wire everything together
11. Smoke test: register a device, run a catalog job, stream the log via curl
12. Frontend scaffold: Vite + React + Router + TanStack Query
13. Dashboard page + DeviceWizard shell + CatalogStage component + JobLog component

---

## External Tool Notes

**czkawka_cli JSON output format:**
`czkawka_cli dup --directories /path --json` outputs a JSON array of arrays.
Each inner array is a duplicate group; each element has `path`, `size`, `hash`,
`modified_date` (Unix timestamp). Parse only after the process exits — the JSON
blob appears at the end of stdout, after progress lines.

**restic tags convention:**
Tag every snapshot: `["device-{id}", "{device_type}", "the-decommissioner"]`.
This lets users find snapshots from outside the app: `restic snapshots --tag device-7`.

**nwipe device path:**
nwipe takes a block device path (e.g., `/dev/sdb`), not a mount point.
The wipe engine must resolve the mount point to the block device via `lsblk --json`.
Unmount the filesystem first before running nwipe.

**Apple checklist state:**
Store the checklist item completion state as a JSON blob in `Job.job_metadata`.
Key: `checklist_items: [{label: str, done: bool}]`.
The API exposes `PATCH /jobs/{id}/checklist` to update individual items.

---

## Development Standards

### Quality Gate — `make check`

**Every task is complete only when `make check` passes without errors.**

`make check` runs, in order:
1. `ruff format --check` — Python formatting (no-diff check)
2. `ruff check` — Python linting
3. `mypy app/` — Python type checking
4. `pytest` — Backend tests with 90%+ coverage enforced
5. `eslint` — Frontend linting (0 errors; warnings OK)
6. `tsc --noEmit` — Frontend type checking
7. `vitest --coverage` — Frontend tests with coverage thresholds

Do not bypass these checks. If a check fails:
- Fix the root cause; don't add `# noqa` or `// eslint-disable` unless the rule is a known false positive.
- For mypy: SQLModel/SQLAlchemy column expressions are excluded from strict checking via per-module overrides — do not disable checking for app logic.

### Writing Tests

**Backend (pytest):**
- Write tests before implementing new features (TDD when practical).
- Coverage threshold: 90% lines/statements; `pytest-cov` enforces this.
- Use `tests/conftest.py` fixtures (`client`, `session`, `engine`) for all API tests.
- Mock `asyncio.create_task` via the `client` fixture — background jobs don't run in tests.
- To test catalog engine behavior, use `test_catalog.py` pattern: call `run_catalog` directly with a real `SubprocessRunner`.
- Do not commit test data files; use `tmp_path`/`source_dir` fixtures.

**Frontend (Vitest + React Testing Library):**
- Coverage thresholds: lines 88%, statements 88%, branches 84%, functions 70%.
- Function threshold is lower than lines/statements because React inline callbacks are hard to isolate.
- Mock all API calls with `vi.mock('../lib/api', () => ({ ... }))`.
- Use `renderWithProviders` from `src/test/helpers.tsx` for components that need Router + QueryClient.
- Mock `EventSource` in `JobLog` tests — jsdom does not support SSE.
- Add `ResizeObserver` stub for components using TanStack Virtual.

### Backend Tooling Config

| Tool | Config location | Notes |
|---|---|---|
| ruff | `backend/pyproject.toml` `[tool.ruff]` | Line length 100, selects E/F/W/I/UP/B/C4/SIM |
| mypy | `backend/pyproject.toml` `[tool.mypy]` | Not strict; SQLAlchemy errors suppressed per-module |
| pytest | `backend/pyproject.toml` `[tool.pytest.ini_options]` | asyncio_mode=auto, cov-fail-under=90 |

### Frontend Tooling Config

| Tool | Config location | Notes |
|---|---|---|
| eslint | `frontend/eslint.config.js` | react-hooks recommended, react-refresh |
| tsc | `frontend/tsconfig.app.json` | App-only; excludes vite/vitest configs |
| vitest | `frontend/vitest.config.ts` | jsdom, globals, v8 coverage |

---

## Makefile Targets

```makefile
dev-backend:   cd backend && uvicorn app.main:app --reload --port 8000
dev-frontend:  cd frontend && npm run dev
build:         cd frontend && npm run build  # output to backend/app/static/
install-deps:  # check + print install commands for missing system deps
docker-up:     docker-compose up --build
test:          cd backend && pytest
lint:          ruff check backend/ && eslint frontend/src/
check:         all quality gates (format + lint + typecheck + test + coverage)
```

---

## Notes for Handoff

This project is designed to be built incrementally. The v0.1 goal is a walking
skeleton: register a device, run a catalog job, and see the log stream in the UI.
Every subsequent feature (duplicate resolution, migration, wipe) adds a new engine
and stage component without changing the core runner or model structure.

The design documents in `docs/` are the authoritative spec. If any implementation
detail conflicts with a doc, update the doc first and note why.
