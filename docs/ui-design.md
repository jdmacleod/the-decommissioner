# the-decommissioner — UI Design

**Stack:** React + Vite + TypeScript + Tailwind + shadcn/ui
**State:** TanStack Query (server state) + Zustand (local UI state)
**Tables:** TanStack Table (virtualized, required for large file manifests)
**Streaming:** native `EventSource` API
**Routing:** React Router v6

---

## Layout Shell

The app has a persistent sidebar and a main content area. No modals for critical
workflows — each step is a full page to give users room to think.

```
┌─────────────────────────────────────────────────────────────┐
│  ◈ the-decommissioner                    ⚙ Settings  ? Help │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  DEVICES     │   <main content area>                        │
│  ──────────  │                                              │
│  ● MBP 2019  │                                              │
│  ○ iPhone X  │                                              │
│  ○ USB-128GB │                                              │
│  ○ WD 2TB    │                                              │
│              │                                              │
│  + Add Device│                                              │
│              │                                              │
│  ──────────  │                                              │
│  Storage     │                                              │
│  ✓ /Volumes/ │                                              │
│    BackupDrv │                                              │
│              │                                              │
│  ──────────  │                                              │
│  Health      │                                              │
│  ✓ restic    │                                              │
│  ✓ czkawka   │                                              │
│  ✗ nwipe     │  ← Linux only; on macOS shows "diskutil" (always found)
└──────────────┴──────────────────────────────────────────────┘
```

Sidebar device list shows a colored dot per device indicating current stage:
- Grey: registered
- Blue: in progress (any job running)
- Yellow: needs attention (unresolved duplicates, missing deps)
- Green: verified or wiped
- Checkmark: recycled (terminal)

---

## Page: Dashboard (`/`)

The landing page when no device is selected. Shows all devices as cards in a
Kanban-style column layout grouped by stage cluster.

```
┌─────────────────────────────────────────────────────────────┐
│  All Devices                              [+ Add Device]    │
├─────────────┬──────────────┬─────────────┬─────────────────┤
│  CATALOG    │  MIGRATE     │  WIPE       │  DONE           │
│  ─────────  │  ──────────  │  ─────────  │  ─────────────  │
│ ┌─────────┐ │ ┌──────────┐ │             │ ┌─────────────┐ │
│ │MBP 2019 │ │ │iPhone X  │ │             │ │ USB-128GB ✓ │ │
│ │Cataloged│ │ │Migrated  │ │             │ │  Recycled   │ │
│ │48k files│ │ │ 12.4 GB  │ │             └─────────────────┘
│ │1.2k dups│ │ │ verified │ │
│ └─────────┘ │ └──────────┘ │
│             │              │
└─────────────┴──────────────┴─────────────┴─────────────────┘
```

Each card shows:
- Device name and type icon (laptop, phone, tablet, drive)
- Current stage label
- Key stats for that stage (file count, duplicate count, GB migrated, etc.)
- Action button: the next step for that device

---

## Page: Add Device (`/devices/new`)

A short wizard — one screen, not multiple steps.

```
┌──────────────────────────────────────────────────────┐
│  Add a Device to Decommission                        │
│                                                      │
│  Name  [Jason's 2019 MacBook Pro          ]          │
│                                                      │
│  Type  ○ Mac  ○ Linux  ● iPhone  ○ iPad              │
│        ○ USB Drive  ○ Hard Drive                     │
│                                                      │
│  Source                                              │
│  ┌────────────────────────────────────────────────┐  │
│  │ For Mac/Linux: paste a path or Browse...       │  │
│  │ For iPhone/iPad: connect device and tap Detect │  │
│  │ For USB/HDD: select from mounted volumes ▾     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Serial #  [optional                      ]          │
│  Notes     [optional                      ]          │
│                                                      │
│                            [Cancel]  [Add Device →]  │
└──────────────────────────────────────────────────────┘
```

For iOS devices, a "Detect" button calls `GET /devices/detect-ios` which runs
`ideviceinfo` and returns device name + serial. Auto-fills the form.

---

## Page: Device Wizard (`/devices/:id`)

The main per-device page. Hosts a stage progress indicator at the top and
renders the active stage component below it.

```
┌──────────────────────────────────────────────────────────────┐
│  ← All Devices      Jason's 2019 MacBook Pro   [Mac]         │
│                                                              │
│  Catalog ──●── Analyze ──○── Migrate ──○── Verify ──○── Wipe ──○── Done  │
│             ↑ current                                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  <Active Stage Component renders here>                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Stage progress bar is read-only — it reflects `device.stage` from the API.
Users advance by completing each stage's action, not by clicking the bar.

---

## Stage Component: Catalog

Shown when `device.stage` is `registered`, `cataloging`, or `cataloged`.

**Sub-state: Ready to catalog**
```
┌──────────────────────────────────────────────────────┐
│  Step 1: Catalog Files                               │
│                                                      │
│  Source: /Users/jason  (127 GB)                      │
│  Tool:   czkawka ✓  (fallback: jdupes ✓)            │
│                                                      │
│  This will scan all files and build an inventory.    │
│  Large drives may take 10–30 minutes.                │
│                                                      │
│                              [Start Catalog →]       │
└──────────────────────────────────────────────────────┘
```

**Sub-state: Cataloging (job running)**
```
┌──────────────────────────────────────────────────────┐
│  Cataloging...                            [Cancel]   │
│                                                      │
│  ████████████░░░░░░░░░░░░░░░  38%                   │
│  Files found: 24,817                                 │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ [2024-01-15 14:23:01] START: czkawka_cli dup  │  │
│  │ Scanning /Users/jason/Documents...            │  │
│  │ Scanning /Users/jason/Pictures...             │  │
│  │ Found 1,204 duplicate groups                  │  │
│  │ ...                                           │  │
│  └────────────────────────────────────────────────┘  │
│  Log: ~/.decommissioner/logs/job_42.log  [Copy path] │
└──────────────────────────────────────────────────────┘
```

The log box is the `JobLog` component — a fixed-height, auto-scrolling div
that receives SSE events via `EventSource`. It auto-scrolls to bottom unless
the user has scrolled up, in which case it pauses auto-scroll.

**Sub-state: Cataloged**
```
┌──────────────────────────────────────────────────────┐
│  ✓ Catalog Complete                                  │
│                                                      │
│  48,203 files  ·  127 GB  ·  completed in 4m 32s    │
│  1,204 duplicate groups found (8.3 GB recoverable)   │
│                                                      │
│  [← Re-catalog]              [Review Files →]        │
└──────────────────────────────────────────────────────┘
```

---

## Stage Component: File Browser (within Catalog stage)

Accessible via "Review Files" after cataloging. A full-screen table view.

```
┌──────────────────────────────────────────────────────────────┐
│  ← Back to Catalog Summary          48,203 files · 127 GB    │
│                                                              │
│  Filter: [____________]  Type: [All ▾]  Status: [All ▾]     │
│  [Select All Keep] [Select All Discard] [Auto-sort by size]  │
│                                                              │
│  ┌──────┬────────────────────────────┬────────┬────────────┐ │
│  │Status│ Path                       │  Size  │  Modified  │ │
│  ├──────┼────────────────────────────┼────────┼────────────┤ │
│  │ [▾]  │ /Users/jason/Documents/... │ 4.2 MB │ 2023-11-01 │ │
│  │ [▾]  │ /Users/jason/Pictures/...  │ 8.7 MB │ 2022-03-14 │ │
│  │ [▾]  │ /Users/jason/Downloads/... │ 1.1 MB │ 2024-01-02 │ │
│  │ ...  │ ...                        │   ...  │    ...     │ │
│  └──────┴────────────────────────────┴────────┴────────────┘ │
│                                                              │
│  Status per row: [Keep ▾] / [Discard ▾] / [Pending ▾]       │
│                                                              │
│  [← Back]                        [Go to Duplicates →]        │
└──────────────────────────────────────────────────────────────┘
```

This table is virtualized with TanStack Table + TanStack Virtual — only
renders the visible rows, so 100k+ file lists stay performant.

Status changes are batched and sent as a `PATCH /file-entries` bulk update
(array of `{id, status}` objects) when the user navigates away or clicks Save.

---

## Stage Component: Duplicate Resolver

Shown when `device.stage` is `analyzing` or `analyzed`.

```
┌──────────────────────────────────────────────────────────────┐
│  Step 2: Resolve Duplicates         1,204 groups · 8.3 GB    │
│                                                              │
│  [Auto-resolve all]  [Show unresolved only ●]                │
│                                                              │
│  Group 1 of 47 unresolved                    [< Prev][Next>] │
│  ─────────────────────────────────────────────────────────── │
│  SHA-256: a3f9... · 3 copies · 4.2 MB each · 8.4 MB waste   │
│                                                              │
│  ○ KEEP  /Users/jason/Documents/Reports/Q4-2023-final.pdf    │
│          MacBook Pro 2019 · modified 2023-12-01              │
│                                                              │
│  ●  DUP  /Users/jason/Downloads/Q4-2023-final.pdf            │
│          MacBook Pro 2019 · modified 2023-11-28              │
│                                                              │
│  ●  DUP  /Volumes/USB-Drive/Backup/Q4-2023-final.pdf         │
│          USB-128GB · modified 2023-11-28                     │
│                                                              │
│  [← Mark all as Discard except top]  [Skip this group →]    │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  Progress: 1,157 resolved  ·  47 remaining                   │
│                            [Continue to Migration →]         │
└──────────────────────────────────────────────────────────────┘
```

Each group shows all copies across all registered devices.
User selects one as KEEP; the rest auto-mark as DUP (Discard).
"Continue" is enabled when 0 unresolved groups remain.

---

## Stage Component: Migrate

```
┌──────────────────────────────────────────────────────────────┐
│  Step 3: Migrate to Storage                                  │
│                                                              │
│  Storage Target: /Volumes/BackupDrive  ✓ initialized         │
│  Files to migrate: 46,999  ·  118.7 GB                       │
│  Files to skip:     1,204  (discarded duplicates)            │
│                                                              │
│  Estimated space after dedup: ~94 GB                         │
│                                                              │
│  [Change target ▾]              [Start Migration →]          │
│  ─────────────────────────────────────────────────────────── │
│  <JobLog component — appears once job starts>                │
└──────────────────────────────────────────────────────────────┘
```

Once migration completes:
```
│  ✓ Migration Complete                                        │
│  Snapshot: a1b2c3d4  ·  46,999 files  ·  94.2 GB            │
│  Added 94.2 GB to repository (2.1 GB already existed)        │
│                                                              │
│  Running verification automatically...                       │
```

Verification auto-starts as a follow-on job — no separate button needed.

---

## Stage Component: Verify

**Sub-state: No discrepancy (happy path)**
```
┌──────────────────────────────────────────────────────────────┐
│  Step 4 — Verify                                             │
│                                                              │
│  ✓ Migration and verification complete                       │
│                                                              │
│  Catalog     5,000 files                                     │
│  In snapshot 5,000 files                                     │
│  Difference  0 files ✓                                       │
│                                                              │
│  Snapshot    abc12345                                        │
│  Total size  2.00 GB                                         │
│  Added (net) 1.80 GB                                         │
│                                                              │
│  ✓ restic check passed — repository is consistent            │
└──────────────────────────────────────────────────────────────┘
```

**Sub-state: Discrepancy detected**
```
┌──────────────────────────────────────────────────────────────┐
│  Step 4 — Verify                                             │
│                                                              │
│  ⚠ Verification found 3 files not present in snapshot       │
│                                                              │
│  Catalog     5,000 files                                     │
│  In snapshot 4,997 files                                     │
│  Difference  3 files missing                                 │
│                                                              │
│  Missing files                         [Filter paths… ]      │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ /Users/jason/Documents/report-final.pdf              │    │
│  │ /Users/jason/Downloads/archive.zip                   │    │
│  │ /Users/jason/Pictures/photo-001.jpg                  │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

Discrepancy data comes from `GET /api/devices/:id/verify-diff`, which reads
`job_metadata` from the latest completed verify job. The verify engine populates
this by running `restic ls <snapshot_id> --json` after `restic check` and diffing
the snapshot path list against migrated FileEntry paths.

When a discrepancy exists, the user should review the missing paths and re-run
migration manually if needed before proceeding to wipe.

---

## Stage Component: Wipe

Rendered differently based on `device.device_type`.

**For HDD/USB drives (automated):**

macOS uses `diskutil secureErase` (built-in); Linux uses `nwipe`. The wipe engine
writes the actual tool name and method to `job_metadata.method` so the UI always
displays the correct tool for the current platform.

```
┌──────────────────────────────────────────────────────────────┐
│  Step 5: Wipe Drive                                          │
│                                                              │
│  Device: /dev/sdb  (WD 2TB)                                  │
│  Method: nwipe — DoD 5220.22-M (3-pass)          ← Linux    │
│        OR diskutil secureErase (3 passes)         ← macOS   │
│                                                              │
│  ⚠ This is irreversible. The drive will be overwritten.      │
│     Verify your migration is complete before proceeding.     │
│                                                              │
│  [ ] I have verified the migration snapshot is intact        │
│                                                              │
│                              [Start Wipe →]  (disabled)      │
│  ─────────────────────────────────────────────────────────── │
│  <JobLog — appears once wipe starts>                         │
└──────────────────────────────────────────────────────────────┘
```

**For Apple devices (guided checklist):**
```
┌──────────────────────────────────────────────────────────────┐
│  Step 5: Prepare for Recycling — iPhone                      │
│                                                              │
│  Complete these steps on the device before handing it off.   │
│                                                              │
│  [ ] Back up complete (done — verified via this app)         │
│  [ ] Unpair Apple Watch (if paired)                          │
│  [ ] Sign out of iCloud                                      │
│       Settings → [Your Name] → Sign Out                      │
│  [ ] Sign out of App Store & iTunes                          │
│  [ ] Disable Find My iPhone                                  │
│       Settings → [Your Name] → Find My → Find My iPhone → Off│
│  [ ] Erase All Content and Settings                          │
│       Settings → General → Transfer or Reset iPhone → Erase  │
│  [ ] Device shows Setup screen (confirms erasure complete)   │
│                                                              │
│  [Apple Support: Before you sell →]  (opens apple.com link)  │
│                                                              │
│                              [Mark as Wiped →] (disabled)    │
└──────────────────────────────────────────────────────────────┘
```

"Mark as Wiped" enables only when all checklist items are checked.
Checklist state persists in the DB as a JSON blob on the Job row.

**For network volumes (out-of-band disconnect checklist):**
```
┌──────────────────────────────────────────────────────────────┐
│  Step 5: Prepare for Recycling                               │
│                                                              │
│  Complete these steps before handing off the share.         │
│                                                              │
│  [ ] Backup complete and verified — all files accounted for  │
│       in the restic snapshot                                 │
│  [ ] Confirm the share owner has been notified and access    │
│       is no longer needed                                    │
│  [ ] Disconnect the share: Finder → right-click volume →    │
│       Eject, or run `umount <path>`                          │
│                                                              │
│                              [Mark as Wiped →] (disabled)    │
└──────────────────────────────────────────────────────────────┘
```

---

## Stage Component: Recycle

Terminal stage. Informational + certificate generation.

```
┌──────────────────────────────────────────────────────────────┐
│  Step 6: Recycle                                             │
│                                                              │
│  ✓ Jason's 2019 MacBook Pro is fully decommissioned.         │
│                                                              │
│  Recycling options:                                          │
│  ● Apple Trade In — get store credit or gift card            │
│    apple.com/shop/trade-in                    [Open →]       │
│  ● Apple Free Recycling — no trade-in value? still accepted  │
│    Drop off at any Apple Store                               │
│  ● Best Buy Electronics Recycling                            │
│    bestbuy.com/recycling                      [Open →]       │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  [Download Decommission Certificate (PDF) →]                 │
│                                                              │
│                              [Mark as Recycled ✓]            │
└──────────────────────────────────────────────────────────────┘
```

The PDF certificate includes:
- Device name, type, serial number
- Dates: registered, cataloged, migrated, wiped, recycled
- File counts and sizes at each stage
- Restic snapshot ID and storage target
- Wipe method (or checklist completion timestamp for Apple devices)
- SHA-256 of the restic repository check output

---

## Component: JobLog

Reused across Catalog, Migrate, Verify, and Wipe stages.

```typescript
// frontend/src/components/JobLog.tsx

interface JobLogProps {
  jobId: number;
  height?: string; // default "300px"
}

export function JobLog({ jobId, height = "300px" }: JobLogProps) {
  const linesRef = useRef<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/jobs/${jobId}/stream`);

    es.onmessage = (e) => {
      linesRef.current = [...linesRef.current, e.data];
      setLines([...linesRef.current]);
    };

    es.addEventListener("done", () => {
      setDone(true);
      es.close();
    });

    return () => es.close();
  }, [jobId]);

  // Auto-scroll logic: pause if user scrolled up
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div className="relative font-mono text-sm bg-gray-950 text-gray-200 rounded-md">
      <div
        ref={containerRef}
        style={{ height, overflowY: "auto" }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 20;
          setAutoScroll(atBottom);
        }}
        className="p-3"
      >
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all leading-5">
            {line}
          </div>
        ))}
        {done && (
          <div className="text-green-400 mt-2">─── Job complete ───</div>
        )}
      </div>
      {!autoScroll && (
        <button
          className="absolute bottom-2 right-2 text-xs bg-gray-700 px-2 py-1 rounded"
          onClick={() => {
            setAutoScroll(true);
            containerRef.current?.scrollTo(0, containerRef.current.scrollHeight);
          }}
        >
          ↓ Scroll to bottom
        </button>
      )}
    </div>
  );
}
```

---

## Component: StageProgress

```typescript
// frontend/src/components/StageProgress.tsx

const STAGES = [
  { label: "Catalog", stages: ["registered", "cataloging", "cataloged"] },
  { label: "Analyze", stages: ["analyzing", "analyzed"] },
  { label: "Migrate", stages: ["migrating", "migrated"] },
  { label: "Verify",  stages: ["verifying", "verified"] },
  { label: "Wipe",    stages: ["wiping", "wiped"] },
  { label: "Done",    stages: ["recycled"] },
];
// Each stage object groups the DeviceStage values that map to that step.
// A step is "complete" when the device stage has moved past it,
// "active" when it's in the step's list, and "pending" otherwise.
```

---

## Page: Settings (`/settings`)

Two sections:

**Storage Target**
- Form to add/edit restic repo path, backend type, password env var name
- "Test connection" button → `POST /storage-targets/{id}/test` → runs `restic snapshots`
- "Initialize" button → `POST /storage-targets/{id}/init` → runs `restic init`

**System Health**
- Table of dependencies with status icons (✓ / ✗ / ⚠)
- Install hint shown for missing deps
- "Re-check" button → `POST /dependencies/check`

---

## API Summary (for implementation reference)

```
Devices:
  GET    /api/devices
  POST   /api/devices
  GET    /api/devices/:id
  PATCH  /api/devices/:id
  DELETE /api/devices/:id
  GET    /api/devices/detect-ios              # ideviceinfo probe → {available, name, serial}
  GET    /api/devices/detect-volumes          # mounted volumes → [{path, label}]
  POST   /api/devices/:id/jobs               # start a job (body: {job_type, storage_target_id?})
  GET    /api/devices/:id/jobs               # list all jobs for a device
  POST   /api/devices/:id/clear-staging      # delete iOS staging dir (post-catalog cleanup)
  POST   /api/devices/:id/mark-wiped         # advance wiping → wiped (Apple checklist)
  POST   /api/devices/:id/mark-recycled      # advance wiped → recycled

File Entries:
  GET    /api/file-entries                   # paginated, filterable (?device_id, status, search)
  PATCH  /api/file-entries                   # bulk status update (body: [{id, status}])

Duplicate Groups:
  GET    /api/duplicate-groups               # ?device_id, ?resolved (bool)
  PATCH  /api/duplicate-groups/:id           # set canonical_entry_id, resolved=true
  POST   /api/duplicate-groups/:device_id/auto-resolve
  GET    /api/duplicate-groups/stats/:device_id  # → {total, resolved, unresolved}

Jobs:
  GET    /api/jobs/:id
  GET    /api/jobs/:id/stream                # SSE log stream
  POST   /api/jobs/:id/cancel
  PATCH  /api/jobs/:id/checklist             # update Apple wipe checklist item (body: {index, done})

Storage Targets:
  GET    /api/storage-targets
  POST   /api/storage-targets
  PATCH  /api/storage-targets/:id
  DELETE /api/storage-targets/:id
  POST   /api/storage-targets/:id/test       # runs restic snapshots → {ok, output}
  POST   /api/storage-targets/:id/init       # runs restic init → {ok, output}

Snapshots:
  GET    /api/devices/:id/snapshots
  GET    /api/devices/:id/verify-diff        # → {discrepancy, catalog_count, snapshot_count, missing_paths}

Dependencies:
  GET    /api/dependencies
  POST   /api/dependencies/recheck           # re-run checker

Certificates:
  GET    /api/devices/:id/certificate        # returns PDF
```
