# Quick Firebase Deployment Guide

## Problem
The browser is showing old cached code with the errors:
- "Invalid collection reference - 6 segments"
- "Cannot create property '_unsub' on number"

This is because the **updated build hasn't been deployed to Firebase Hosting yet**.

## Solution: Deploy Updated Build

### Step 1: Verify Build is Fresh
✅ New build created: `dist/` folder (date: 1/24/2026)
✅ Contains fixed code without the errors

### Step 2: Deploy via Firebase Console

#### Option A: Manual Upload via Web Console (Easiest)

1. **Go to Firebase Console**
   - Open: https://console.firebase.google.com/project/swu-holocron-93a18/hosting

2. **Click "Connect repository"** or find **"Add web app"**

3. **Select "Upload folder"**
   - Click the **Upload** button
   - Navigate to: `f:\SWU-Holocron\SWU-Holocron\dist`
   - Select the entire `dist` folder
   - Click Upload

4. **Wait for deployment** (~1-2 minutes)
   - Firebase will deploy the new version
   - You'll see a checkmark when complete

5. **Clear browser cache and reload**
   - Press `Ctrl+Shift+Delete` (clear cache)
   - Or use: `Ctrl+Shift+R` (hard refresh)
   - Visit: https://swu.holocronlabs.net

#### Option B: Use Firebase CLI (When Working)

```powershell
cd f:\SWU-Holocron\SWU-Holocron
firebase deploy --only hosting
```

#### Option C: Deploy Firestore Rules (If not done yet)

If you haven't deployed the updated firestore.rules file:

1. Go to: https://console.firebase.google.com/project/swu-holocron-93a18/firestore
2. Click **Rules** tab
3. Click **Edit Rules**
4. Paste the content from `firestore.rules`:

```firestore
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // Primary collection: user-scoped data under artifacts/{APP_ID}/users/{uid}
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Public card database: read-only access to cardDatabase for all authenticated users
    match /artifacts/{appId}/public/data/cardDatabase/{document=**} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // Temporary legacy read-only access for sync_* collections during migration
    match /artifacts/{appId}/public/data/{syncId}/{document=**} {
      allow read: if request.auth != null && request.time < timestamp.date(2025, 2, 1);
      allow write: if false;
    }
  }
}
```

5. Click **Publish**

## Verification Steps

After deployment, test these in the browser console:

1. **No permission errors**
   ```javascript
   // You should see this message:
   ✓ Available sets from Firestore
   // NOT this:
   ✗ Missing or insufficient permissions
   ```

2. **No collection path errors**
   ```javascript
   // You should see:
   Setting up collection listener
   // NOT:
   Invalid collection reference - 6 segments
   ```

3. **No timer errors**
   ```javascript
   // You should see:
   Collection updated: X items
   // NOT:
   Cannot create property '_unsub' on number
   ```

4. **Cards load**
   - Select a set (e.g., SOR)
   - Should show: `✓ Loaded X cards from Firestore (SOR)`
   - Cards should display in grid

## Troubleshooting Deployment

### If you still see old errors:
1. **Hard refresh**: `Ctrl+Shift+R` (not just Ctrl+R)
2. **Clear cache**: Press `Ctrl+Shift+Delete`
3. **Incognito window**: `Ctrl+Shift+N` and visit the site fresh
4. **Wait 5 minutes**: Browser/CDN cache might need time to clear

### If deployment fails in console:
- Use **Option C** to at least deploy the firestore.rules
- The frontend will at least have correct permissions then

### Current Status
- ✅ Source code fixed in Git repo
- ✅ Fresh build created locally
- ⏳ **PENDING: Deploy build to Firebase Hosting**
- ⏳ **PENDING: Deploy firestore.rules (if not done)**

## Files to Deploy

1. **Hosting**: Entire `dist/` folder
2. **Firestore**: `firestore.rules` file

Both are in: `f:\SWU-Holocron\SWU-Holocron\`

---

**Next Step**: Deploy the `dist/` folder via Firebase Console → Hosting → Upload
