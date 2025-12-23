# Card Database Management Guide

## Overview

The SWU Holocron uses a **Firestore-first architecture** for card data. This eliminates reliability issues with external APIs and provides an offline-first experience.

## Architecture

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────┐
│   GitHub Action │──────>│  Firestore DB    │<──────│   Users     │
│  (Daily Sync)   │       │  (Primary Source)│       │  (Read Only)│
└─────────────────┘       └──────────────────┘       └─────────────┘
         │                         ▲
         │                         │
         ▼                         │
┌─────────────────┐               │
│  SWU-DB API     │───────────────┘
│  (Data Source)  │
└─────────────────┘
```

**Key Principles:**
- ✅ Users **never** call external APIs directly
- ✅ All card data served from Firestore
- ✅ Background sync keeps database up to date
- ✅ Works 100% offline once data is cached

## Initial Setup

### 1. Seed the Database

Before the app can work, you need to populate Firestore with card data.

#### Option A: Run Locally (Recommended for first time)

```powershell
# Install Firebase Admin SDK
npm install firebase-admin --save-dev

# Create service account key (see below)
# Place firebase-admin-key.json in project root

# Run seed script
npm run admin:seed-cards
```

**Expected Output:**
```
============================================================
  SWU Holocron - Card Database Seeding
============================================================

[SOR] Spark of Rebellion
----------------------------------------
Fetching SOR (attempt 1/3)...
✓ Fetched 258 cards from SOR
✓ Saved 258 cards to Firestore (SOR)

[SHD] Shadows of the Galaxy
----------------------------------------
...

Summary:
  ✓ Successful sets: 3/3
  ✓ Total cards: 516
  ✗ Errors: 0
  ⏱ Duration: 23.45s
```

#### Option B: Use Admin Panel (In-Browser)

1. Navigate to `/admin` in your app
2. Click "Manual Sync" button
3. Wait for completion (~30 seconds)

### 2. Get Firebase Service Account Key

For GitHub Actions or local scripts:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Click Settings (⚙️) → Project settings
4. Go to **Service accounts** tab
5. Click **Generate new private key**
6. Save as `firebase-admin-key.json` (do NOT commit this!)

### 3. Configure GitHub Secrets

For automated syncs:

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Click **New repository secret**
4. Name: `FIREBASE_SERVICE_ACCOUNT`
5. Value: Paste entire contents of `firebase-admin-key.json`
6. Save

## Background Sync

### Automated Sync (GitHub Actions)

The database automatically syncs **daily at 6 AM UTC**.

**Workflow:** `.github/workflows/sync-cards.yml`

**What it does:**
- Fetches latest card data from SWU-DB API
- Compares with Firestore using data hashes
- Updates only if changes detected
- Creates sync log for monitoring
- Notifies on failures (creates GitHub issue)

**Manual Trigger:**
1. Go to **Actions** tab in GitHub
2. Select "Sync Card Database"
3. Click **Run workflow**
4. Choose options and run

### Manual Sync (Admin Panel)

For immediate updates:

1. Navigate to `/admin` route
2. Click **Manual Sync** button
3. Confirm the action
4. Wait for completion notification

**When to use:**
- New set just released
- Errata/corrections published
- API data inconsistencies reported
- First-time database setup

## Monitoring

### Admin Dashboard

Access at `/admin` (requires authentication in production).

**Metrics Displayed:**
- Sync status (healthy/error)
- Last sync timestamp
- Total cards in database
- Sets synced and versions
- Recent sync logs (last 10)
- Manual sync controls

### Sync Logs

Located in Firestore:
```
artifacts/{APP_ID}/admin/sync/logs/{timestamp}
```

**Log Contents:**
```javascript
{
  timestamp: 1703347200000,
  status: "success",
  sets: ["SOR", "SHD", "TWI"],
  cardCount: 516,
  duration: 12350,
  source: "swu-db.com",
  errors: [],
  changes: { updated: 2, failed: 0 }
}
```

### Health Checks

**Signs of Healthy System:**
- ✅ `syncStatus: "healthy"` in metadata
- ✅ `lastFullSync` < 48 hours old
- ✅ No errors in recent logs
- ✅ Card count matches expected totals

**Warning Signs:**
- ⚠️ Last sync > 48 hours ago
- ⚠️ Errors in sync logs
- ⚠️ Card count mismatches
- ⚠️ GitHub Action failures

## Troubleshooting

### Sync Fails: "Failed to fetch {SET}"

**Cause:** SWU-DB API is down or rate-limiting

**Solution:**
1. Wait 1 hour and retry
2. Check https://api.swu-db.com/cards/sor manually
3. If API is truly down, old data remains cached (users unaffected)

### "No Firestore data for {SET}"

**Cause:** Database not seeded yet

**Solution:**
```powershell
npm run admin:seed-cards
```

### GitHub Action: "Permission denied"

**Cause:** Service account key invalid or missing

**Solution:**
1. Regenerate service account key
2. Update `FIREBASE_SERVICE_ACCOUNT` secret
3. Re-run workflow

### Cards Not Updating in App

**Cause:** Client-side localStorage cache

**Solution:**
```javascript
// In browser console
localStorage.clear();
location.reload();
```

Or add cache-busting to `CardService`:
```javascript
const cacheKey = `swu-cards-${activeSet}-v2`; // Increment version
```

## Firestore Security Rules

Ensure these rules are set:

```javascript
match /artifacts/{appId}/public/data/cardDatabase/{document=**} {
  // Anyone can read card data
  allow read: if true;
  
  // Only service account can write (admin == true claim)
  allow write: if request.auth.token.admin == true;
}

match /artifacts/{appId}/admin/sync/{document=**} {
  // Only admins can read sync logs
  allow read: if request.auth.token.admin == true;
  
  // Only service account can write logs
  allow write: if request.auth.token.admin == true;
}
```

## Performance & Costs

### Firestore Usage

**Reads (User-facing):**
- 1 read per set load
- ~3 reads per user session
- Estimated: 30K reads/day (10K daily users)
- Cost: Free tier covers 50K/day

**Writes (Sync):**
- ~10 writes per sync (metadata + logs)
- 1 sync per day = 10 writes/day
- Cost: Free tier covers 20K/day

**Storage:**
- ~1MB per set (with all fields)
- 3 sets = 3MB total
- Cost: Free tier covers 1GB

**Verdict:** Should remain within free tier indefinitely.

### GitHub Actions

**Minutes Used:**
- ~2 minutes per sync
- 30 syncs/month = 60 minutes
- Free tier: 2,000 minutes/month

**Verdict:** <5% of free tier used.

## Advanced: Adding New Sets

When a new set releases (e.g., "Twilight of the Republic" - TWI):

1. **Update Constants:**
   ```javascript
   // src/constants.js
   export const SETS = [
     { code: 'SOR', name: 'Spark of Rebellion' },
     { code: 'SHD', name: 'Shadows of the Galaxy' },
     { code: 'TWI', name: 'Twilight of the Republic' }, // New!
   ];
   ```

2. **Run Sync:**
   ```powershell
   npm run admin:seed-cards
   ```
   
   Or trigger GitHub Action manually.

3. **Verify:**
   - Check admin dashboard shows new set
   - Load new set in app
   - Confirm card count matches official count

## Alternative Data Sources

If SWU-DB becomes unreliable:

### Option 1: Karabast.net
- Community-maintained database
- Good for validation
- May need web scraping

### Option 2: Official FFG Sources
- Product pages have official card text
- Manual verification only (no API)
- Use for dispute resolution

### Option 3: Table Top Simulator Mods
- Steam Workshop has card images/data
- Requires parsing mod files
- Good image source backup

**Implementation:** Modify `scripts/seedCardDatabase.js` to add fallback sources.

## FAQ

**Q: What happens if sync fails?**
A: Old data remains in Firestore. Users experience zero downtime. Sync retries next day.

**Q: Can users trigger sync?**
A: No. Only admins via admin panel or GitHub Actions can sync.

**Q: How do I verify database integrity?**
A: Run `npm run admin:verify-db` (compares Firestore with API).

**Q: What if I want to rollback a sync?**
A: Firestore doesn't have built-in versioning. Implement backup script if needed, or rely on daily syncs to self-correct.

**Q: Can I sync more frequently than daily?**
A: Yes, edit `.github/workflows/sync-cards.yml` cron schedule. But daily is recommended to avoid API rate limits.

---

**Related Documentation:**
- [Architecture Design Doc](./CARD-DATABASE-ARCHITECTURE.md)
- [Firestore Schema](../src/services/CardService.js)
- [Sync Script Source](../scripts/seedCardDatabase.js)
