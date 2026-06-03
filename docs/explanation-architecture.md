# Architecture Explanation

This document explains three non-obvious design decisions in the-decommissioner: why the device stage is a forward-only FSM, why the log file is the SSE source of truth, and why passwords are kept in environment variables instead of the database.

---

## The forward-only device FSM

### The problem

Hardware decommissioning is a destructive, irreversible process. Once a drive is wiped, the data is gone. If the app allowed the stage to move backward freely — say, from `verified` back to `cataloged` because a re-catalog job failed — the UI could suggest the user still needs to complete steps they already finished, and a wipe could trigger before migration is confirmed.

### The approach

`device.stage` only moves forward. Each API endpoint that triggers a job checks the current stage before accepting the request. A failed job leaves the device at its last successful stage — not at a stage before it.

```
registered → cataloging → cataloged → analyzing → analyzed
  → migrating → migrated → verifying → verified
  → wiping → wiped → recycled
```

The stage transitions happen inside the job execution, not on the trigger call. So triggering a catalog job moves the device to `cataloging`; only after the job completes successfully does it advance to `cataloged`.

**Re-catalog exception:** The one backward transition allowed is re-cataloging from `cataloged`. This resets the device to `cataloged` (not `registered`) and clears the old file entries. The user sees this as a "Re-catalog" button that replaces old data. Everything downstream (duplicate groups, migration) is also cleared.

### Trade-offs

- **Given up:** You can't undo a wipe trigger via the UI. If you accidentally trigger a wipe on the wrong device, cancel the job immediately.
- **Alternative considered:** A "rollback" mechanism per stage. Rejected because it would require cascading rollbacks (verified → unverify restic snapshot data?) that are either lossy or complex, and the primary use case (planned decommissioning) doesn't need rollback.

---

## The log file as SSE source of truth

### The problem

The SSE endpoint streams live job output to the browser. Naively, you'd keep log lines in memory and write them to the response stream. But that has two failure modes:

1. The user's browser disconnects mid-job and reconnects — they miss all output between disconnect and reconnect.
2. The server restarts while a job is running — the in-memory log is lost.

### The approach

Every subprocess output byte is written to `{DATA_DIR}/logs/job_{id}.log` before it's yielded to the SSE response stream. The SSE endpoint tails this file.

When a client connects (or reconnects), it reads from the beginning of the log file. This gives any client a full replay at zero extra cost. The runner doesn't need to know how many clients are connected or buffer anything for reconnection.

```
subprocess stdout/stderr
        │
        ▼
  job_{id}.log (append)
        │
        ├──▶ SSE /api/jobs/{id}/stream (tail -f style)
        │         client A
        │         client B (reconnecting)
        └──▶ log replay on reconnect
```

### Trade-offs

- **Given up:** Logs are never deleted automatically — they accumulate in `DATA_DIR/logs/` over time. Clean them up manually if disk space is a concern.
- **Alternative considered:** In-memory ring buffer with fixed capacity. Rejected because it creates a split source of truth and makes replay unreliable for long jobs.

---

## Passwords in environment variables, not the database

### The problem

A restic repository password is a secret. Storing it in the SQLite database means it's in a file on disk, visible to anyone with read access to `DATA_DIR`. It also appears in any database backup or migration.

### The approach

`StorageTarget.restic_password_env` stores the *name* of an environment variable (e.g. `RESTIC_PASSWORD`), not the password itself. At runtime, when any engine calls restic, it passes `env={restic_password_env: os.environ[restic_password_env]}` to the subprocess. The password never touches the database or any log file.

To use multiple repositories with different passwords, define multiple environment variables before starting the app:

```bash
export RESTIC_PASSWORD=main-repo-password
export RESTIC_PASSWORD_OFFSITE=offsite-repo-password
```

Then set each storage target's `restic_password_env` field to the appropriate variable name.

### Trade-offs

- **Given up:** The app won't start correctly if the environment variable isn't exported. Users who launch the app from a desktop shortcut (without a shell) may be confused. The Settings page shows which variable each target expects, which helps diagnose missing variables.
- **Alternative considered:** Encrypting the password before storing it in the database. Rejected because it requires managing an encryption key, which has the same bootstrapping problem: where do you store the key?

---

## Related

- [Stage reference](reference-stages.md)
- [Subprocess runner design](subprocess-runner.md) — detailed runner implementation
- [Data models](data-models.md) — full table definitions
