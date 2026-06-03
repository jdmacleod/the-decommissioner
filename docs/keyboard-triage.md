# Keyboard Triage

Keyboard triage is a fullscreen mode for resolving duplicate groups using only the keyboard. It's designed for the common case where you have dozens or hundreds of duplicate groups and want to clear them quickly without reaching for the mouse.

The core idea: the app suggests which copy to keep based on folder location. Most suggestions are obvious. You press Space to accept, J to skip, K to go back. When you're done, a receipt screen shows only the decisions where the suggestion was uncertain — typically 5% of groups. You review those, click Finish, and the device advances to the next stage.

---

## How to open triage mode

1. Navigate to a device that is in the `analyzing` stage.
2. Click **Resolve Duplicates** from the device wizard.
3. Click **Keyboard triage ⌨** in the page header.

The triage overlay opens fullscreen. Your existing resolved groups are not shown — only the unresolved ones.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` or `Enter` | Accept the suggested keeper and advance to the next group |
| `J` or `↓` | Skip to the next group without resolving (come back with K) |
| `K` or `↑` | Go back to the previous group |
| `1` – `9` | Pick the file at that index (1-based) as the keeper |

**End of queue:** Pressing `J` on the last group, or pressing `Space` on the last group, transitions to the receipt screen.

**Out-of-range index:** Pressing `5` on a group with 3 entries is a no-op. For groups with more than 9 files, use the mouse to click any file beyond index 9.

**Input suppression:** Keyboard shortcuts are suppressed when a text input or textarea has focus, so you can safely use browser devtools or any overlaid input without firing triage actions.

---

## How the suggestion is made

The app scores each file's path using a named-folder heuristic: recognized folder names map to scores, and the highest score across all segments of the path wins.

| Folder name | Score |
|---|---|
| `Documents` | 10 |
| `Desktop` | 8 |
| `Pictures`, `Movies`, `Music` | 7 |
| `Downloads` | 6 |
| `home`, `Users` | 5 |
| *(unrecognized)* | 4 |
| `private` | 2 |
| `var`, `tmp` | 1 |

**Example:** `/Users/jason/Documents/report.pdf` scores 10 (`Documents`), not 5 (`Users`), because the heuristic takes the maximum score across all segments.

**Tie-break:** When two files score equally, the more recently modified file wins (ISO 8601 string comparison, which is lexicographically correct).

The suggested keeper is highlighted in green with a "suggested" label. Low-confidence groups — where the top two files score within 1 point of each other — show a yellow "low confidence" badge.

---

## The receipt screen

After the last group, the receipt screen shows:

- **How many groups you resolved** and the total bytes recovered (sum of duplicate sizes minus keeper sizes).
- **Low-confidence decisions** — only the groups where the top two files' path scores were within 1 point. These are the calls where the heuristic was least sure.

If all your decisions were high-confidence, the receipt shows: "All decisions were high-confidence — nothing to review."

Click **Finish** to invalidate the duplicate-groups cache and return to the device wizard, where the stage will have advanced to `analyzed`.

---

## What happens on the backend

Each acceptance fires a `PATCH /duplicate-groups/{id}` call with the chosen `canonical_entry_id`. The backend:
1. Sets `canonical_entry_id` on the group.
2. Marks the chosen entry `status = keep`.
3. Marks every other entry in the group `status = discard`.
4. Checks if all groups for the device are now resolved — if so, advances `device.stage` to `analyzed`.

If the PATCH fails (network error, server error), the cursor has already advanced but an error toast appears: "Failed to record — press K to go back and try again." Pressing K reverses the cursor so you can retry.

---

## Mouse fallback

The existing card-by-card UI remains accessible at all times. Click **Exit triage** to close the overlay and return to the standard resolver. You can mix keyboard triage and mouse resolution freely — triage only shows unresolved groups, so any groups you resolved with the mouse won't appear.

---

## Related

- [Stage reference](reference-stages.md) — `analyzing` and `analyzed` stages
- [How to decommission a device](tutorial-first-decommission.md) — full walkthrough
