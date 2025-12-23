# Admin Scripts

This directory contains administrative scripts for managing the SWU Holocron card database.

## Scripts

### `seedCardDatabase.js`

Seeds or updates the Firestore card database with data from SWU-DB API.

**Usage:**
```powershell
npm run admin:seed-cards
```

**When to use:**
- Initial database setup
- Manual sync after new set release
- Recovery from sync failures
- Testing database operations

**Requirements:**
- Firebase Admin SDK credentials (`firebase-admin-key.json`)
- Network access to SWU-DB API
- Firestore write permissions

**Duration:** ~30-60 seconds for all sets

**What it does:**
1. Fetches card data from API for each set
2. Calculates data hash for change detection
3. Compares with existing Firestore data
4. Updates only if changes detected
5. Creates sync log entry
6. Updates metadata document

---

### `verifyCardDatabase.js`

Verifies the integrity of the Firestore card database.

**Usage:**
```powershell
# Basic verification (Firestore only)
npm run admin:verify-db

# With API comparison
node scripts/verifyCardDatabase.js --compare-api
```

**When to use:**
- After seeding database (verify success)
- Debugging card data issues
- Monthly health checks
- Before major deployments

**What it checks:**
- All expected sets present
- Card counts reasonable
- Data structure valid
- Metadata document exists
- Sync timestamps recent
- (Optional) Data matches API

**Output:**
```
✅ SOR - 258 cards (synced 12h ago)
✅ SHD - 258 cards (synced 12h ago)
❌ TWI - NOT FOUND

Summary:
  Sets found: 2/3
  Total cards: 516
  Issues: 1
```

---

## Setup

### 1. Install Firebase Admin SDK

```powershell
npm install firebase-admin --save-dev
```

### 2. Get Service Account Key

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Project Settings → Service Accounts
3. Generate new private key
4. Save as `firebase-admin-key.json` in project root

**⚠️ IMPORTANT:** Never commit `firebase-admin-key.json` to git!

### 3. Test Connection

```powershell
npm run admin:verify-db
```

Should show metadata and set information.

---

## Environment Variables

Scripts support environment variables for CI/CD:

```powershell
# Use JSON string instead of file
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content firebase-admin-key.json -Raw
node scripts/seedCardDatabase.js
```

Used by GitHub Actions workflow.

---

## Troubleshooting

### "Cannot find module 'firebase-admin'"

**Solution:**
```powershell
npm install firebase-admin --save-dev
```

### "ENOENT: no such file or directory, open 'firebase-admin-key.json'"

**Solution:**
- Ensure `firebase-admin-key.json` exists in project root
- Or set `FIREBASE_SERVICE_ACCOUNT` environment variable

### "Permission denied" errors

**Solution:**
- Verify service account has Firestore write permissions
- Check Firebase project ID is correct
- Regenerate service account key

### "Failed to fetch {SET} after 3 attempts"

**Solution:**
- Check internet connection
- Verify SWU-DB API is accessible: https://api.swu-db.com/cards/sor
- Try again after 1 hour (may be rate-limited)

### Firestore writes failing

**Solution:**
- Check Firestore security rules allow admin writes
- Verify service account has correct permissions
- Check Firebase project quota limits

---

## Best Practices

### Local Development

1. **Keep credentials secure**
   - Add `firebase-admin-key.json` to `.gitignore`
   - Never commit credentials
   - Rotate keys every 90 days

2. **Test before deploying**
   - Run verify script after seed
   - Check admin panel in app
   - Spot-check card data

3. **Monitor sync logs**
   - Review Firestore sync logs collection
   - Check for errors or warnings
   - Validate card counts

### Production

1. **Use GitHub Actions**
   - Store credentials in GitHub Secrets
   - Let automated sync handle updates
   - Only manual sync for emergencies

2. **Monitor health**
   - Check admin dashboard weekly
   - Set up alerting for failures
   - Review GitHub Action logs

3. **Handle failures gracefully**
   - Old data remains cached (users unaffected)
   - Retry sync next day automatically
   - Manual intervention rarely needed

---

## Related Documentation

- [Card Database Architecture](../docs/CARD-DATABASE-ARCHITECTURE.md)
- [Card Database Management Guide](../docs/CARD-DATABASE-MANAGEMENT.md)
- [Implementation Summary](../docs/IMPLEMENTATION-SUMMARY.md)

---

## Future Scripts (Planned)

- `backupCardDatabase.js` - Create versioned snapshots
- `migrateCardDatabase.js` - Migrate schema changes
- `auditCardDatabase.js` - Detect duplicates/inconsistencies
- `importImages.js` - Cache images to Firestore Storage
