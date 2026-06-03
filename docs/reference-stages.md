# Stage and Status Reference

Complete reference for device stages, file statuses, job types, and device types.

---

## Device stages

A device moves through these stages in order. The stage only moves forward — a failed job leaves the device at its last successful stage.

| Stage | Entered when | What it means |
|---|---|---|
| `registered` | Device is created | Starting state. No catalog has run. |
| `cataloging` | Catalog job starts | Walk and hash in progress. |
| `cataloged` | Catalog job completes | All files hashed; duplicate groups detected. |
| `analyzing` | User opens the duplicate resolver | Duplicate resolution in progress. |
| `analyzed` | All duplicate groups resolved | Every group has a canonical keeper chosen. |
| `migrating` | Migrate job starts | `restic backup` running. |
| `migrated` | Migrate job completes | All `keep`-status files are in the restic snapshot. |
| `verifying` | Verify job starts | `restic check` and snapshot diff running. |
| `verified` | Verify job completes | Every cataloged file confirmed present in the snapshot. |
| `wiping` | Wipe job starts | `nwipe` or Apple checklist in progress. |
| `wiped` | Wipe job completes (HDD) or checklist finished (Apple) | Drive erased or Apple erase steps done. |
| `recycled` | User marks device recycled | Final state. Decommission certificate available. |

**Re-catalog exception:** Running a new catalog job from `cataloged` resets the stage to `cataloged` and clears prior file entries. This is the only backward transition allowed.

---

## File statuses

Each `FileEntry` row has a `status` field.

| Status | Meaning |
|---|---|
| `pending` | Cataloged; no decision made yet |
| `keep` | Chosen by the user or auto-resolver as the canonical copy |
| `discard` | Duplicate of a `keep` entry; will not be migrated |
| `migrated` | Confirmed present in the restic backup |
| `verified` | Confirmed present after `restic check` |

Files stay `pending` until a duplicate group is resolved or the user explicitly marks them via the File Browser. Auto-resolve sets `keep` on the deepest-path duplicate and `discard` on the rest. Keyboard triage sets `keep`/`discard` based on your choice.

---

## Job types

| Job type | Engine | External tool | What it does |
|---|---|---|---|
| `catalog` | `engines/catalog.py` | `czkawka_cli` (or `jdupes`) | Walks source path; SHA-256 hashes all files; detects duplicate groups |
| `ios_extract` | `engines/ios.py` | `ideviceinfo`, `ifuse` | Extracts iOS device files to a staging directory via AFC |
| `migrate` | `engines/migrate.py` | `restic backup` | Backs up all `keep`-status files to the configured storage target |
| `verify` | `engines/verify.py` | `restic check`, `restic snapshots` | Confirms snapshot integrity and that every file is present |
| `wipe` | `engines/wipe.py` | `nwipe` (HDD/Linux) | Wipes block device; Apple devices use an interactive checklist instead |

---

## Job statuses

| Status | Meaning |
|---|---|
| `pending` | Created; not yet started |
| `in_progress` | Running |
| `completed` | Finished successfully |
| `failed` | Subprocess exited non-zero or engine raised |
| `cancelled` | Cancelled by user via `POST /jobs/{id}/cancel` |

---

## Device types

| Type | Source path | iOS extraction | Wipe method |
|---|---|---|---|
| `mac` | A local or mounted path | No | Apple checklist |
| `linux` | A local or mounted path | No | `nwipe` (Linux only) |
| `iphone` | None (extracted via AFC) | Yes | Apple checklist |
| `ipad` | None (extracted via AFC) | Yes | Apple checklist |
| `usb_drive` | Mount point | No | `nwipe` (Linux only) |
| `hard_drive` | Mount point | No | `nwipe` (Linux only) |

---

## Storage backends

| Backend | `path` format | Notes |
|---|---|---|
| `local` | Absolute path on disk | e.g. `/Volumes/Backup/restic-repo` |
| `sftp` | `sftp:host:/path` | Requires SSH key auth; no password prompts |
| `s3` | `s3:bucket-name/path` | Requires `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in environment |

All backends use restic under the hood. The repository password is passed through the environment variable named in `restic_password_env` — never stored in the database.

---

## Related

- [How to configure storage targets](howto-storage-targets.md)
- [Keyboard triage reference](keyboard-triage.md)
- [Architecture explanation](explanation-architecture.md)
