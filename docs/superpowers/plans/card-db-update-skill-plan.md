# Plan: Card DB Update Skill & Scheduled Task

Task: Build a Claude Code skill and scheduled task that orchestrates card database updates — seeding from SWU-DB API, scraping the official site, reconciling disagreements (official wins), verifying integrity, and logging results. Triggered on release dates from a calendar file.

Final deliverable: A working Claude Code skill (`swu-card-db-update`) + scheduled task + release calendar config, all tested end-to-end.

Audience: Developer (self) and future Claude Code instances operating in this repo.

Constraints:
- Reuse existing scripts (`seedCardDatabase.js`, `scrapeOfficialCards.js`, `verifyCardDatabase.js`) — don't rewrite them
- Runs locally on the dev machine (not GitHub Actions)
- Requires `firebase-admin-key.json` in `SWU-Holocron/`
- Playwright must be installed for official site scraping
- Silent operation with log files — no interactive prompts

## Known Issue to Fix

`verifyCardDatabase.js` line 35 hardcodes `APP_ID = 'swu-holocron'` while every other script imports it from `firebase.js` as `swu-holocron-v1`. This will cause verification to read from the wrong Firestore path. Must be fixed in chunk 1.

---

## Chunks

### 1. Create the reconciliation + orchestrator script
   Input: Existing scripts (`seedCardDatabase.js`, `scrapeOfficialCards.js`, `verifyCardDatabase.js`), understanding of Firestore schema
   Action:
   - Create `SWU-Holocron/scripts/cardDbSync.js` — a unified orchestrator that:
     1. Runs seed (SWU-DB API → Firestore) for all sets in `constants.js`
     2. Runs official site scrape → Firestore `official-data` docs
     3. Reconciles: for each set, compares `data` (API) vs `official-data` (scraped). For any field-level disagreements on the same card (matched by Set+Number), overwrites the API value with the official value in the `data` doc. Logs every override.
     4. Runs verification to confirm DB integrity
     5. Writes a JSON log to `SWU-Holocron/logs/card-sync-YYYY-MM-DD.json` with: timestamp, sets processed, cards added/updated/overridden, errors, duration
   - The script should import and call the existing scripts' exported functions rather than shelling out
   - Fix `verifyCardDatabase.js` to import APP_ID from `firebase.js` instead of hardcoding it
   - Add `"admin:sync-full": "node scripts/cardDbSync.js"` to `package.json`
   - Ensure `logs/` dir is `.gitignore`d
   Output: `SWU-Holocron/scripts/cardDbSync.js` working end-to-end, `verifyCardDatabase.js` APP_ID fix applied
   Parallel: no

### 2. Create the release calendar config
   Input: Knowledge of upcoming/past SWU set releases
   Action:
   - Create `SWU-Holocron/config/release-calendar.json`:
     ```json
     {
       "description": "Card DB sync schedule. Add dates when new sets release. The sync task runs on these dates.",
       "releases": [
         { "date": "2026-03-27", "set": "LAW", "name": "A Lawless Time" },
         { "date": "2026-03-28", "set": "LAW", "note": "day-after followup" }
       ]
     }
     ```
   - Include past sets with approximate release dates for reference (commented or with a `"past": true` flag)
   - Add a `"fallback_interval_days"` field (default: `null` / disabled) for future use if we want periodic runs as a safety net
   Output: `SWU-Holocron/config/release-calendar.json`
   Parallel: yes (independent of chunk 1)

### 3. Create the Claude Code skill
   Input: Working orchestrator from chunk 1
   Action:
   - Create `.claude/skills/swu-card-db-update.md` — a Claude Code skill file that:
     - Triggers on: "update cards", "sync card database", "refresh card data", "new set", "card data stale"
     - Describes the pipeline steps clearly
     - Instructs Claude to run `cd SWU-Holocron && node scripts/cardDbSync.js`
     - Instructs Claude to read and summarize the resulting log file
     - Includes instructions for adding new release dates to the calendar
   Output: `.claude/skills/swu-card-db-update.md`
   Parallel: no (needs chunk 1 complete to reference the script)

### 4. Create the scheduled task
   Input: Working skill from chunk 3, release calendar from chunk 2
   Action:
   - Use the Claude Code `/schedule` skill to create a scheduled task that:
     - Runs daily at a fixed time (e.g., 8 AM local)
     - Reads `SWU-Holocron/config/release-calendar.json`
     - If today's date matches any entry in `releases`, runs the full sync pipeline
     - If no match, exits silently (no log, no noise)
     - On match: runs `cd SWU-Holocron && node scripts/cardDbSync.js` and writes output to log
   Output: A configured Claude Code scheduled task
   Parallel: no (needs chunks 1-3)

### 5. End-to-end test
   Input: All chunks complete
   Action:
   - Manually trigger the skill to run the full pipeline
   - Verify LAW set gets populated in Firestore
   - Verify log file is written with correct structure
   - Verify the scheduled task is registered and would trigger on today's date (add a test entry for today)
   - Clean up test entry from release calendar
   Output: Confirmation that the full pipeline works, LAW set is live in the app
   Parallel: no

### 6. Review gate
   Run /review on the full deliverable (orchestrator script, calendar config, skill file, scheduled task) against this plan before marking complete.

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `SWU-Holocron/scripts/cardDbSync.js` | Create | Unified orchestrator: seed → scrape → reconcile → verify → log |
| `SWU-Holocron/scripts/verifyCardDatabase.js` | Fix | Import APP_ID from firebase.js instead of hardcoding |
| `SWU-Holocron/config/release-calendar.json` | Create | Release dates that trigger sync |
| `SWU-Holocron/package.json` | Edit | Add `admin:sync-full` script |
| `SWU-Holocron/.gitignore` | Edit | Add `logs/` if not present |
| `.claude/skills/swu-card-db-update.md` | Create | Claude Code skill definition |
| Scheduled task | Create | Via Claude Code /schedule |

## Dependencies

```
[1] cardDbSync.js + verify fix
       ↓
[3] Claude Code skill ←── [2] release calendar (parallel with 1)
       ↓
[4] Scheduled task
       ↓
[5] End-to-end test
       ↓
[6] Review gate
```
