# Card Database Architecture & Background Sync

## Problem Statement

The current implementation has reliability issues due to direct API calls to `swu-db.com/api`:
- Network timeouts and failures interrupt user experience
- CORS proxy failures with multiple fallback strategies
- No offline capability when API is down
- Performance issues from repeated API calls
- Single point of failure (swu-db.com API)

## Architecture Goals

1. **Zero Live API Calls** - All user-facing requests served from Firestore
2. **Background Sync** - Automated background tasks update card database
3. **Multi-Source Validation** - Cross-reference multiple card data sources
4. **Version Control** - Track card database versions and changes
5. **Offline-First** - Full functionality without network access
6. **Admin Tools** - Easy management and manual sync capabilities

## Data Sources

### Primary Source: SWU-DB API
- **URL**: `https://api.swu-db.com/cards/{set}`
- **Format**: JSON
- **Reliability**: Generally good, but has downtime
- **Update Frequency**: Updated with new sets, occasional corrections
- **Pros**: Official-feeling, comprehensive, images hosted
- **Cons**: Single point of failure, CORS issues, no guaranteed SLA

### Secondary Sources (For Validation)

#### 1. Karabast (Community Hub)
- **Website**: https://karabast.net
- **Data**: Community-maintained card database
- **Format**: Web scraping or possible API
- **Use Case**: Validation, errata tracking
- **Priority**: Medium

#### 2. Official FFG Product Database
- **Website**: Fantasy Flight Games official site
- **Data**: Official card text and images
- **Format**: Product pages, no structured API
- **Use Case**: Canonical source for disputes
- **Priority**: Low (manual verification only)

#### 3. Table Top Simulator Mods
- **Source**: Steam Workshop TTS mods
- **Data**: Card images and stats
- **Format**: Mod files (JSON/Lua)
- **Use Case**: Alternative image sources
- **Priority**: Low

### Recommended Strategy
- **Primary**: SWU-DB API (most comprehensive)
- **Validation**: Manual spot-checks against official FFG sources
- **Fallback**: Cached data in Firestore (never fails)

## Firestore Schema

### Collection: `artifacts/{APP_ID}/public/data/cardDatabase`

#### Document: `sets/{setCode}`
```javascript
{
  code: "SOR",           // Set code
  name: "Spark of Rebellion",
  releaseDate: "2024-03-08",
  totalCards: 258,
  lastSync: 1703347200000,  // Timestamp
  syncVersion: "v1.2",
  syncSource: "swu-db.com",
  cards: [                   // Full card array
    {
      Set: "SOR",
      Number: "001",
      Name: "Director Krennic",
      Subtitle: "Aspiring to Authority",
      Type: "Leader",
      Aspects: ["Villainy", "Command"],
      Traits: ["Imperial", "Official"],
      Cost: null,
      Power: null,
      HP: 28,
      FrontText: "...",
      DoubleSided: true,
      Unique: true,
      Rarity: "Rare",
      Artist: "...",
      // ... full card data
    }
  ]
}
```

#### Document: `metadata/sync`
```javascript
{
  lastFullSync: 1703347200000,
  lastPartialSync: 1703350800000,
  syncStatus: "healthy", // "healthy" | "syncing" | "error"
  syncErrors: [],
  setVersions: {
    "SOR": "v1.2",
    "SHD": "v1.1",
    "TWI": "v1.0"
  },
  nextScheduledSync: 1703437200000
}
```

### Collection: `artifacts/{APP_ID}/admin/sync/logs`

#### Document: `{timestamp}`
```javascript
{
  timestamp: 1703347200000,
  type: "full" | "partial" | "validation",
  status: "success" | "failed",
  sets: ["SOR", "SHD"],
  cardCount: 516,
  duration: 12350, // ms
  source: "swu-db.com",
  errors: [],
  changes: {
    added: 5,
    updated: 12,
    removed: 0
  }
}
```

## Background Sync Architecture

### Approach 1: Firebase Cloud Functions (Recommended)

**Pros**:
- Serverless, scales automatically
- Scheduled triggers with Firebase Extensions or Pub/Sub
- Secure (runs in trusted environment)
- Direct Firestore access (no auth issues)

**Cons**:
- Requires Firebase Blaze plan (pay-as-you-go)
- ~$0.40 per million invocations (negligible for our use)

**Implementation**:
```javascript
// functions/syncCardDatabase.js
exports.scheduledCardSync = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    // Sync logic here
  });
```

### Approach 2: GitHub Actions (Alternative)

**Pros**:
- Free for public repos (2,000 minutes/month)
- Easy to set up and monitor
- Can run on schedule (cron)
- No Firebase plan upgrade needed

**Cons**:
- Requires service account key management
- Less integrated with Firebase
- Need to handle auth

**Implementation**:
```yaml
# .github/workflows/sync-cards.yml
name: Sync Card Database
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  workflow_dispatch:      # Manual trigger
```

### Approach 3: Admin Panel Background Task

**Pros**:
- Simple implementation
- No external dependencies
- Runs in user's browser (no server costs)

**Cons**:
- Requires admin to be logged in
- Less reliable (depends on browser staying open)
- Not truly "background"

**Use Case**: Manual sync tool only, not automated

## Recommended Implementation Plan

### Phase 1: Firestore Card Storage (Immediate)
1. ✅ Create Firestore schema for card database
2. ✅ Build admin tool to seed initial data
3. ✅ Update `CardService.fetchSetData()` to read from Firestore first
4. ✅ Keep API fallback for now (removed in Phase 3)

### Phase 2: Background Sync (Week 1)
1. ✅ Choose sync approach (GitHub Actions recommended for MVP)
2. ✅ Implement sync script in `/scripts/syncCardDatabase.js`
3. ✅ Add validation logic (compare sources)
4. ✅ Set up GitHub Action workflow
5. ✅ Configure GitHub secrets for Firebase admin SDK

### Phase 3: Hardening (Week 2)
1. ✅ Remove all direct API calls from client code
2. ✅ Add version tracking and change detection
3. ✅ Implement sync error notifications
4. ✅ Add admin UI for manual sync and monitoring
5. ✅ Create sync logs dashboard

## Sync Logic Flow

```
┌─────────────────────────────────────────────────────┐
│         GitHub Actions (Scheduled Daily)            │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │  Sync Script Start  │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Fetch from SWU-DB   │───┐
         │ for each set        │   │ Timeout/Error
         └──────────┬──────────┘   │
                    │               │
                    ▼               ▼
         ┌─────────────────────┐   ┌──────────────┐
         │ Compare with        │   │ Log Error &  │
         │ Firestore version   │   │ Skip Set     │
         └──────────┬──────────┘   └──────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Detect Changes      │
         │ (hash comparison)   │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Update Firestore    │
         │ if changes found    │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Update metadata     │
         │ & create log entry  │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │    Sync Complete    │
         └─────────────────────┘
```

## Migration Strategy

### Step 1: Seed Initial Data (Admin Tool)
```bash
npm run admin:seed-cards
```
- Fetches all sets from API
- Populates Firestore
- Creates initial version markers

### Step 2: Update Client Code
- Change `CardService.fetchSetData()` to prioritize Firestore
- Remove CORS proxy fallbacks
- Add version checking

### Step 3: Deploy Background Sync
- Set up GitHub Action or Cloud Function
- Run first sync manually
- Monitor for 48 hours

### Step 4: Remove API Fallback
- Client now 100% Firestore-based
- API only used by sync script
- Offline-first complete

## Monitoring & Maintenance

### Health Checks
- **Sync Success Rate**: Track in metadata doc
- **Last Sync Age**: Alert if > 48 hours
- **Card Count Verification**: Detect missing sets
- **Error Rate**: Log all sync failures

### Admin Dashboard Metrics
- Last sync timestamp
- Total cards in database
- Sets synced vs. sets available
- Recent sync logs (success/failures)
- Manual sync button

### Alerting (Optional)
- Email admin if sync fails 3 times
- Discord webhook for sync status
- GitHub Issues auto-creation on persistent errors

## Cost Analysis

### Firestore Costs (Spark Plan - Free Tier)
- **Reads**: 50K/day free (cards fetched by users)
- **Writes**: 20K/day free (sync updates)
- **Storage**: 1 GB free (~500 cards = ~1MB, plenty of room)
- **Estimate**: Should stay within free tier for <10K users/day

### GitHub Actions (Free Tier)
- **Minutes**: 2,000/month free
- **Sync Duration**: ~2 min/sync
- **Daily syncs**: 30 syncs/month = 60 minutes used
- **Estimate**: Well within free tier

### Cloud Functions (If Used)
- **Invocations**: $0.40 per million
- **Daily sync**: 1 invocation/day = 30/month = negligible
- **Estimate**: <$0.01/month

## Security Considerations

### Service Account Key (GitHub Actions)
- Store Firebase Admin SDK key in GitHub Secrets
- Use read/write permissions only for card database paths
- Rotate keys every 90 days

### Firestore Security Rules
```javascript
match /artifacts/{appId}/public/data/cardDatabase/{document=**} {
  // Anyone can read card data
  allow read: if true;
  
  // Only admin service account can write
  allow write: if request.auth.token.admin == true;
}
```

### API Rate Limiting
- Respect swu-db.com rate limits
- Add exponential backoff on failures
- Cache aggressively to minimize requests

## Future Enhancements

1. **Multi-Language Support**: Sync card text in multiple languages
2. **Image Optimization**: Cache and serve optimized images from Firestore Storage
3. **Real-Time Updates**: WebSocket notifications when new cards added
4. **Community Contributions**: Allow verified users to submit corrections
5. **Diff Viewer**: Show what changed between sync versions
6. **Rollback Capability**: Revert to previous card database version

## Decision: Use GitHub Actions for MVP

**Rationale**:
- Zero cost (free tier sufficient)
- No Firebase plan upgrade needed
- Easy to monitor and debug
- Can migrate to Cloud Functions later if needed
- Transparent (sync logs in GitHub Actions UI)
