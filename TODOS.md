# TODOs

Deferred items from design/eng reviews. Not in scope for the current sprint.

---

## Known Issues

### SSE live tail: SQLAlchemy session may not see committed job status

**File:** `backend/app/api/jobs.py` — `_tail_log()`

`_tail_log()` polls `session.get(Job, job_id)` every 0.2s to detect when a live
job completes. The `session` is the request-scoped FastAPI `SessionDep` session.
SQLAlchemy's identity map caches the first load; without an explicit expiry or a
fresh session per iteration, subsequent `session.get()` calls may return the
cached `in_progress` status instead of reading the committed `completed` status
from the runner's separate session.

**Symptom:** SSE stream for a live job may not terminate after the job finishes.

**Fix:** Call `session.expire(job)` before each `session.get()`, or open a fresh
session per poll iteration:

```python
session.expire(job)
job = session.get(Job, job_id)
```

**Discovered:** During progress-feedback eng review (2026-06-18).
**Priority:** Medium — affects UX (stuck loading) but doesn't cause data loss.

---
