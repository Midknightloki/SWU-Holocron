# 🔐 Deploying Firestore Security Rules

The app is working (cards are loading), but it's using **fallback API access** instead of Firestore because the Security Rules haven't been deployed to Firebase yet.

## Why This Matters

- **Current State**: App falls back to external API (slower, CORS errors, less reliable)
- **Desired State**: App loads directly from Firestore (faster, reliable, authenticated)
- **Blocker**: Firestore Security Rules are committed to git but NOT deployed to Firebase Console

## Quick Deploy (5 minutes)

### Option 1: Using Firebase CLI (Recommended)

```bash
# 1. Install Firebase CLI globally (if not already)
npm install -g firebase-tools

# 2. Login to Firebase
firebase login

# 3. From the SWU-Holocron project root, deploy rules
firebase deploy --only firestore:rules
```

### Option 2: Manual Deploy via Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **swu-holocron-93a18**
3. Navigate to **Firestore Database** → **Rules**
4. Copy the content from [firestore.rules](./SWU-Holocron/firestore.rules)
5. Paste it into the Firebase Console rules editor
6. Click **Publish**

## What Gets Deployed

The [firestore.rules](./SWU-Holocron/firestore.rules) file defines:

```
- User collections: /artifacts/{appId}/users/{userId}/* (read/write own data)
- Card database: /artifacts/{appId}/public/data/cardDatabase/* (read-only for authenticated users)
- Legacy data: /artifacts/{appId}/public/data/sync_* (read-only for migration)
```

## Verification

After deployment, check the console for success messages:

```javascript
// Should see this:
✓ Available sets from Firestore: ["SOR", "SHD", "TWI", "JTL", "LOF", "SEC", "LAW"]
✓ Loaded 89 cards from Firestore (SHD)

// NOT this (fallback):
⚠ Could not determine available sets, using defaults
⚠ No Firestore data found for SHD, attempting direct API fetch
```

## Troubleshooting

**"Missing or insufficient permissions"**
- Rules not deployed
- User not authenticated
- Check browser console for auth status: `console.log(auth.currentUser)`

**"Could not fetch sets from Firestore"**
- Check network tab in DevTools
- Verify Firestore database exists in Firebase Console
- Check that rules are published (green checkmark)

**"Rule compilation error"**
- Syntax error in firestore.rules
- Check Firebase Console error message
- Refer to [Firestore Security Rules documentation](https://firebase.google.com/docs/firestore/security/start)

## Current Database Structure

The rules protect access to:

```
/artifacts
  /{appId}                              # Application instance (swu-holocron-v1)
    /users
      /{userId}                         # User's personal collection
        /collectionSync
        /myCollection
        /stats
        ...
    /public
      /data
        /cardDatabase                   # Public card database (READ-ONLY)
          /sets                         # Collection of set documents
            /{setCode}                  # Document: SHD, SOR, TWI, etc.
              /data                     # Document containing cards array
        /sync_*                         # Legacy cache (being phased out)
```

## Next Steps

1. Deploy rules using Firebase CLI or Console
2. Hard refresh browser (Ctrl+Shift+R)
3. Check console for "✓ Available sets from Firestore" message
4. Verify cards still load properly

---

**Status**: Rules committed to repo but NOT YET deployed to Firebase  
**Blocker**: Manual Firebase Console action required  
**Impact**: App works via fallback API, but slower and less reliable
