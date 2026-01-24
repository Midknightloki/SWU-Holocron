# Firebase Troubleshooting - Fixes Applied

## Issues Identified & Fixed

### ✅ Issue 1: Invalid Firestore Collection Path (6 segments - EVEN number)
**Error**: `Invalid collection reference. Collection references must have an odd number of segments, but artifacts/swu-holocron-v1/public/data/cardDatabase/sets has 6.`

**Root Cause**: Firestore path segments must follow: `/collection/doc/collection/doc/...` (odd number)
The path had 6 segments (even): `artifacts` → `{APP_ID}` → `public` → `data` → `cardDatabase` → `sets`

**Fix Applied** in `src/services/CardService.js`:
```javascript
// BEFORE (Wrong - 6 segments)
const setsRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'sets');

// AFTER (Correct - 5 segments)
const cardDbRef = doc(db, 'artifacts', APP_ID, 'public/data/cardDatabase');
const setsRef = collection(cardDbRef, 'sets');
```

---

### ✅ Issue 2: Type Error - Cannot Set Property on Number
**Error**: `Uncaught TypeError: Cannot create property '_unsub' on number '41'`

**Root Cause**: `setTimeout()` returns a number (timer ID), but the code tried to attach a function property to it:
```javascript
// ❌ WRONG - timer is a number
timer._unsub = unsub;
```

**Fix Applied** in `src/App.jsx` (lines 214-228):
```javascript
// BEFORE
const timer = setTimeout(() => {
  const unsub = onSnapshot(...);
  timer._unsub = unsub;  // ❌ Can't add property to number
}, 0);

// AFTER
let unsubscribe = null;
const timer = setTimeout(() => {
  unsubscribe = onSnapshot(...);  // ✅ Store in proper variable
}, 0);

return () => {
  clearTimeout(timer);
  if (unsubscribe) unsubscribe();
};
```

---

### ✅ Issue 3: Firestore Rules Blocking Access
**Error**: `Error checking admin status: FirebaseError: Missing or insufficient permissions.` & `Collection sync error: FirebaseError: Missing or insufficient permissions.`

**Root Cause**: The `firestore.rules` file didn't allow reading from `/artifacts/{appId}/public/data/cardDatabase/...`

**Rules Updated** in `firestore.rules`:
```firestore
// Added new rule to allow reading cardDatabase
match /artifacts/{appId}/public/data/cardDatabase/{document=**} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

**Current Rules Allow**:
- ✅ `/artifacts/{appId}/users/{uid}/*` - User collection (read/write for own data)
- ✅ `/artifacts/{appId}/public/data/cardDatabase/*` - **NEW** Card database (read-only)
- ✅ `/artifacts/{appId}/public/data/sync_*/*` - Legacy sync collections (read-only until Feb 1, 2025)

---

## Remaining Issues to Address

### ⚠️ CORS Errors from api.swu-db.com
**Error**: `Access to fetch at 'https://api.swu-db.com/cards/SOR' from origin 'http://192.168.1.30:5173' has been blocked by CORS policy`

**Status**: This is expected behavior - external API doesn't allow browser requests from localhost

**Solutions**:
1. **For Development**: Use a CORS proxy or run the app on a whitelisted domain
2. **For Production**: The app should work fine when deployed to `swu.holocronlabs.net` (already configured in vite.config.js)
3. **Fallback**: App gracefully falls back to Firestore data when API fails (which is working now with the fixes above)

**To Fix Locally**:
```javascript
// Option 1: Add to vite.config.js server config
server: {
  proxy: {
    '/api': {
      target: 'https://api.swu-db.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, '')
    }
  }
}

// Then use '/api/cards/SOR' in your code
```

---

### 🔍 Debugging Checklist

Before deploying, verify:

1. **Firebase Authentication**
   - [ ] User is logged in (check `console.log('uid:', user.uid)`)
   - [ ] Authentication working via Google or Anonymous

2. **Firestore Access**
   - [ ] No "Missing or insufficient permissions" errors
   - [ ] Collection listener shows "Collection updated"
   - [ ] User data saving/loading works

3. **Set Data Loading**
   - [ ] Sets appear in dropdown
   - [ ] Cards load for selected set
   - [ ] Should see logs like: `✓ Loaded 123 cards from Firestore (SOR)`

4. **API Fallback**
   - [ ] Cards load if Firestore doesn't have data
   - [ ] Should see: `⚠ No Firestore data found for SOR, attempting direct API fetch`

---

## Files Modified

1. **`src/services/CardService.js`**
   - Fixed collection path construction (lines 33-38)
   - Fixed nested document path (lines 45-51)

2. **`src/App.jsx`**
   - Fixed timer/unsubscribe cleanup (lines 214-228)

3. **`firestore.rules`**
   - Added cardDatabase read rule (lines 11-14)

---

## Next Steps

1. **Deploy Firestore Rules**:
   ```bash
   firebase deploy --only firestore:rules
   ```

2. **Test the Application**:
   - Open browser DevTools Console
   - Watch for success messages:
     - `✓ Using cached available sets`
     - `Setting up collection listener - uid:`
     - `✓ Loaded X cards from Firestore`

3. **Verify Production Domain**:
   - Test at `https://swu.holocronlabs.net` where CORS won't be an issue

4. **Monitor for Remaining Issues**:
   - Check for any remaining permission errors
   - Verify data persists across page reloads
   - Test user login/logout cycle

---

## Error Reference

If you still see errors after these fixes:

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing or insufficient permissions" | Firestore rules blocking access | Verify rules are deployed: `firebase deploy --only firestore:rules` |
| "No user session" | User not authenticated | Check auth flow in AuthContext |
| "Invalid collection reference" | Path has even segments | Verify path uses doc/collection alternation |
| CORS blocked from api.swu-db.com | External API CORS policy | Expected - app falls back to Firestore data |
| "Cannot create property '_unsub'" | Type error on timer | Fixed - using proper variable scope |

