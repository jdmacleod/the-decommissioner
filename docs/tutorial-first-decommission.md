# Tutorial: Decommission your first drive

In this tutorial you'll register an external hard drive, catalog its files, resolve duplicates using keyboard triage, migrate the keepers to a restic backup, verify the backup, and generate a decommission certificate. By the end you'll have a complete record of what was on the drive and proof that it was safely archived before erasure.

This takes 15-30 minutes of active time (plus however long your catalog and backup run — a 500 GB drive with 100k files typically catalogs in under 5 minutes on a modern machine).

---

## What you'll need

- The app running locally (native install) — see [Quick start](../README.md#quick-start)
- An external drive mounted on your machine
- `restic` installed (`brew install restic` on macOS, `apt install restic` on Linux)
- A destination for the backup: a local external drive, SFTP host, or S3 bucket
- Your restic repository password in your environment: `export RESTIC_PASSWORD=your-passphrase`

---

## Step 1: Configure your backup destination

Before registering a device, set up where you want files to go.

1. Click **Settings** in the left sidebar.
2. Click **Add storage target**.
3. Fill in the form. For a local backup:
   - Name: `Local SSD`
   - Backend: `local`
   - Path: `/Volumes/BackupSSD/restic-repo` (or wherever you want the repo)
   - Password env var: `RESTIC_PASSWORD`
   - Check **Default**
4. Click **Save**, then click **Init** on the new target card.

You should see a green confirmation after Init completes. If not, check [How to configure storage targets](howto-storage-targets.md).

---

## Step 2: Register the device

1. Click **+ Add device** in the left sidebar (or the button on the Dashboard).
2. Fill in:
   - **Name**: something recognizable, like "Jason's 2015 MacBook Air"
   - **Type**: `hard_drive` for an external drive, `mac` if it's the internal drive from a Mac
   - **Source path**: the mount point, e.g. `/Volumes/OldDrive`
3. Optionally drag a photo onto the photo slot so you can identify the hardware at a glance.
4. Click **Save**.

The device appears on the Dashboard in the "Registered" column.

---

## Step 3: Catalog the files

Click the device to open the wizard, then click **Start Catalog**.

The catalog job walks every file under the source path, computes a SHA-256 hash, and detects duplicates using czkawka. You'll see the live log stream appear in the browser — no need to stay on the page, you can navigate away and come back.

When the job finishes, the panel shows:
- Total file count
- Number of duplicate groups found

Click **Review Files** to see everything in the File Browser (filterable by status), or proceed straight to **Resolve Duplicates**.

---

## Step 4: Resolve duplicates with keyboard triage

Click **Resolve Duplicates** from the wizard or from the post-catalog panel. The duplicate resolver opens, showing groups of files with identical content.

For a quick run through all groups at once:

1. Click **Keyboard triage ⌨** in the header.
2. The triage overlay opens. The first group is shown with the suggested keeper highlighted in green.
3. Press **Space** to accept the suggestion and move to the next group.
4. Press **J** to skip a group without resolving (come back with **K**).
5. Press **1** through **9** to pick a specific file by index if you disagree with the suggestion.

When you reach the last group, the **receipt screen** appears:
- It shows how many groups you resolved and how many bytes will be recovered.
- It lists only the **low-confidence** decisions — groups where the heuristic wasn't sure which copy was better.

Review any listed decisions. If you want to change one, close the overlay, find the group in the standard resolver, and re-resolve it (your previous choice will be shown; picking a different entry updates it).

Click **Finish**. The device advances to the `analyzed` stage.

**Tip:** Most drives have 5-30 low-confidence groups out of hundreds. The path heuristic is right ~95% of the time for files in standard macOS folder layouts.

---

## Step 5: Migrate to backup

The wizard now shows **Step 3 — Migrate to Storage** as active.

Click **Start Migration**. The migrate job runs `restic backup` on all files marked `keep`. You'll see the live backup progress in the log stream.

When complete, the panel shows the snapshot ID and file count.

---

## Step 6: Verify the backup

Click **Start Verify**. The verify job runs `restic check` on the repository and then cross-references every cataloged file against the snapshot. If any file is missing from the snapshot, verification fails and the device stays at `migrated` — you'd re-run migration before proceeding.

When verify completes, the panel confirms the count matches.

---

## Step 7: Wipe (optional)

> **Only do this after verifying.** The wipe step is irreversible.

For HDD/Linux devices, click **Start Wipe**. This runs `nwipe` on the block device. You must be on a Linux host with `nwipe` installed (`apt install nwipe`). If you're on macOS and want to wipe an external drive, use Disk Utility's "Erase" with the security options appropriate for your drive type, then mark the device as wiped manually.

For Mac/iPhone/iPad, the app shows Apple's recommended erase checklist. Each step (Sign out of iCloud, Erase All Content and Settings, etc.) has a checkbox. Check each as you complete it in the device's Settings. When all items are checked, click **Mark as Wiped**.

---

## Step 8: Recycle and get your certificate

Click **Mark as Recycled** and confirm the prompt. The device moves to `recycled`.

Click **Download Certificate** to get a PDF decommission record showing:
- Device name, type, and serial number
- File count and total size
- Restic snapshot ID
- Timestamp of each completed stage
- Optional device photo

Store the certificate with your asset disposal records.

---

## What you built

You've walked the full decommission pipeline: catalog → triage → migrate → verify → (wipe) → recycle. The files from your drive are now in a deduplicated restic snapshot, and you have a signed record of the decommission.

**Next steps:**
- [Keyboard triage reference](keyboard-triage.md) — full keyboard shortcut reference and confidence heuristic details
- [Stage reference](reference-stages.md) — all stages, file statuses, and job types
- [How to configure storage targets](howto-storage-targets.md) — SFTP and S3 setup
