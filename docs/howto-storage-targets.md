# How to configure storage targets

A storage target is a restic repository where your device's files are backed up during the Migrate stage. You can have multiple targets; one is marked as the default.

---

## Prerequisites

- restic installed (`brew install restic` on macOS, `apt install restic` on Linux)
- For SFTP: SSH key-based auth configured to the remote host
- For S3: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` set in your shell environment

---

## Step 1: Set your password in the environment

The app never stores your restic repository password. Pick a name for the environment variable that will hold it, and export it before starting the app:

```bash
export RESTIC_PASSWORD=your-secure-passphrase
```

You can use any variable name. If you manage multiple repositories with different passwords, use separate variables:

```bash
export RESTIC_PASSWORD_HOME=passphrase-for-home-backup
export RESTIC_PASSWORD_OFFSITE=passphrase-for-offsite
```

---

## Step 2: Open Settings

Click **Settings** in the left sidebar, or navigate to [http://localhost:8000/settings](http://localhost:8000/settings).

---

## Step 3: Add a storage target

Click **Add storage target** and fill in the form:

| Field | Description |
|---|---|
| **Name** | A human-readable label (e.g. "External SSD" or "B2 Offsite") |
| **Backend** | `local`, `sftp`, or `s3` |
| **Path** | Repository path (see formats below) |
| **Password env var** | Name of the environment variable holding the password (e.g. `RESTIC_PASSWORD`) |
| **Default** | Check this to use this target for all new migrations |

**Path formats by backend:**

| Backend | Example path |
|---|---|
| `local` | `/Volumes/BackupDrive/restic-repo` |
| `sftp` | `sftp:backuphost.local:/home/restic/repo` |
| `s3` | `s3:s3.amazonaws.com/my-bucket/restic` |

---

## Step 4: Initialize the repository

If this is a new repository (not a pre-existing restic repo), click **Init** on the target card. This runs `restic init` with your password.

If you're connecting to an existing restic repository, skip Init — the Test button will confirm the connection.

---

## Step 5: Test the connection

Click **Test** on the target card. This runs `restic snapshots` to verify the credentials and connectivity. A green confirmation means the target is ready to use.

---

## Verification

On the Settings page, the target card shows one of:
- Green dot + "OK" — test passed
- Red dot + error message — check your path, password variable name, and that the variable is exported in the shell running the app

---

## Troubleshooting

**"repository does not exist"** — You need to run Init first, or the path is wrong.

**"wrong password"** — The environment variable name in the form doesn't match the variable you exported, or the variable isn't in the shell that started the app. Restart the app with the correct variable exported.

**"connection refused" (SFTP)** — The SSH key for your user on the remote host isn't set up. Test `ssh backuphost.local` manually first.

**"access denied" (S3)** — Check that `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are exported in the environment where the app is running, and that the IAM policy allows `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on the bucket.

---

## Using multiple repositories

You can add multiple storage targets. During the Migrate stage, the device wizard uses the default target automatically. To use a different target for a specific device, there is currently no per-device override — change the default target before triggering migration.

---

## Related

- [Reference: storage backends](reference-stages.md#storage-backends)
- [Tutorial: decommission a device](tutorial-first-decommission.md)
