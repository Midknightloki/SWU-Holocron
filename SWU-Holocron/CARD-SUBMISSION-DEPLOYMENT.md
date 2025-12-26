# Card Submission Feature - Deployment Guide

## Overview

This feature allows users to submit missing cards (especially variants and promos) to the SWU Holocron database. It includes:

- ✅ Official code support (printed format like "G25-3")
- ✅ Admin role system with Firestore-based authorization
- ✅ Firebase Storage for user-uploaded images
- ✅ Real-time duplicate detection
- ✅ Camera capture with frame overlay for mobile
- ✅ Submission queue for admin review

## Files Added/Modified

### New Files Created

**Utilities:**
- `src/utils/officialCodeUtils.js` - Convert between printed/full official codes
- `src/utils/submissionTypes.js` - TypeScript-style type definitions and validation
- `src/utils/duplicateDetection.js` - Fuzzy matching and duplicate checking

**Components:**
- `src/components/CardSubmissionForm.jsx` - Main submission form UI

**Scripts:**
- `scripts/research-official-api.js` - Tool to investigate starwarsunlimited.com structure
- `scripts/add-admin-user.js` - CLI tool for granting admin privileges

**Configuration:**
- `storage.rules` - Firebase Storage security rules
- `firebase.json` - Updated to include storage rules

### Files Modified

- `src/firebase.js` - Added Firebase Storage export
- `src/contexts/AuthContext.jsx` - Added admin role checking
- `src/components/AdminPanel.jsx` - Added auth guard
- `src/App.jsx` - Added submission form navigation

## Deployment Steps

### 1. Install Dependencies

No new dependencies required! All features use existing Firebase SDK.

### 2. Deploy Firebase Storage Rules

```bash
cd SWU-Holocron

# Deploy storage rules
firebase deploy --only storage

# Verify deployment
firebase deploy --only storage --dry-run
```

### 3. Set Up Admin User

First, you need to get your Firebase User UID:

**Option A: From Firebase Console**
1. Go to Firebase Console → Authentication → Users
2. Sign in to your app at least once
3. Find your email in the user list and copy the UID

**Option B: From Browser Console**
1. Sign in to SWU Holocron
2. Open browser dev tools (F12)
3. Console tab, run: `firebase.auth().currentUser.uid`
4. Copy the UID

**Grant Admin Privileges:**

```bash
cd SWU-Holocron

# Install firebase-admin if not already installed
npm install firebase-admin

# Run admin script
node scripts/add-admin-user.js add <YOUR_UID> <YOUR_EMAIL>

# Example:
# node scripts/add-admin-user.js add abc123xyz user@example.com

# List all admin users
node scripts/add-admin-user.js list
```

**Note:** You need `firebase-admin-key.json` in your project root. Download it from:
1. Firebase Console → Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Save as `firebase-admin-key.json`

### 4. Deploy Updated Application

```bash
# Build the app
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting

# Or deploy everything at once
firebase deploy
```

### 5. Verify Deployment

**Test Admin Access:**
1. Navigate to your deployed app
2. Sign in with the admin account
3. Admin panel should be accessible (previously it had no auth guard)
4. You should see "Submit Missing Card" button in navigation

**Test Submission Form:**
1. Click the document icon (📄) in the top navigation
2. Form should load with image upload options
3. Try entering an official code (e.g., "G25-3")
4. Duplicate checking should activate after typing

**Test Camera Capture (Mobile):**
1. Open app on mobile device
2. Navigate to submission form
3. Click "Take Photo" button
4. Camera should open with card frame overlay

## How to Use the Feature

### For Users

1. **Find the Missing Card**
   - Go to https://starwarsunlimited.com/cards
   - Find the card you want to submit
   - Note the official code (bottom-right corner, e.g., "G25-3")

2. **Submit the Card**
   - Sign in to SWU Holocron (must use Google, not guest)
   - Click the 📄 icon in the navigation bar
   - Fill in the official code
   - Upload or take photos of the card (front and back if double-sided)
   - Fill in card details
   - Review duplicate warnings
   - Click "Submit Card"

3. **Track Submission**
   - Submissions go to pending queue
   - Admin will review and approve/reject
   - (Future: User dashboard to track submissions)

### For Admins

**Current Status:** Admin moderation dashboard not yet implemented.

**Temporary Review Process:**
1. Go to Firebase Console → Firestore
2. Navigate to: `artifacts/swu-holocron-v1/submissions/pending`
3. Review submitted cards manually
4. Approve: Copy data to main card database
5. Reject: Update status to "rejected" with reason

**Coming Soon:** Full admin moderation UI with approve/reject buttons.

## Firestore Collections

### Submissions Collection

**Path:** `artifacts/swu-holocron-v1/submissions/pending/{submissionId}`

**Schema:**
```javascript
{
  userId: string,              // User UID who submitted
  userEmail: string,           // User email
  submittedAt: timestamp,      // When submitted
  status: string,              // "pending", "approved", "rejected"
  
  submittedData: {
    OfficialCode: string,      // Printed format (e.g., "G25-3")
    OfficialCodeFull: string,  // Full format (e.g., "G25090003")
    Set: string,               // Internal set code
    Number: string,            // Card number
    Name: string,              // Card name
    // ... other card properties
  },
  
  images: {
    frontUrl: string,          // Firebase Storage URL
    backUrl: string|null,      // For double-sided cards
    frontPath: string,         // Storage path
    backPath: string|null
  },
  
  officialUrl: string|null,    // From starwarsunlimited.com
  possibleDuplicates: array,   // Detected duplicate cards
  
  reviewedBy: string|null,     // Admin UID who reviewed
  reviewedAt: timestamp|null,  // When reviewed
  reviewNotes: string,         // Admin comments
  rejectionReason: string|null // If rejected
}
```

### User Profiles Collection

**Path:** `artifacts/swu-holocron-v1/users/{uid}/profile`

**Schema:**
```javascript
{
  isAdmin: boolean,            // Admin flag
  email: string,               // User email
  grantedAt: timestamp,        // When admin was granted
  grantedBy: string            // Who granted admin
}
```

## Firebase Storage Structure

**User Submissions:**
```
user-submissions/
  ├── {userId}/
  │   ├── {submissionId}/
  │   │   ├── front.jpg        (uploaded by user)
  │   │   └── back.jpg         (if double-sided)
```

**Approved Cards:**
```
card-images/
  ├── {setCode}/
  │   ├── {cardCode}/
  │   │   ├── front.jpg        (moved after approval)
  │   │   └── back.jpg
```

## Security Rules

### Firestore Rules (existing)

Submissions collection follows user authentication:
- Users can create submissions (write to their own user ID)
- Users can read their own submissions
- Admins can read/write all submissions

### Storage Rules (new)

**User Submissions:**
- Users can upload to their own folders
- Users can read their own submissions
- Admins can read all submissions

**Approved Cards:**
- Anyone can read (public)
- Only admins can write

**Rules enforced:**
- 10MB file size limit
- Image files only
- Authenticated users only (no anonymous uploads)

## Testing Checklist

- [ ] Storage rules deployed successfully
- [ ] Admin user can access admin panel
- [ ] Non-admin users see "Access Denied" on admin panel
- [ ] Submission form loads without errors
- [ ] Official code input auto-parses to Set + Number
- [ ] Duplicate detection shows warnings for existing cards
- [ ] Image upload works (file selection)
- [ ] Camera capture works on mobile
- [ ] Card frame overlay displays during capture
- [ ] Form validation catches missing required fields
- [ ] Submission saves to Firestore
- [ ] Images upload to Firebase Storage
- [ ] Submission appears in pending queue
- [ ] Storage URLs are accessible

## Troubleshooting

### "Firebase not configured" error

**Solution:** Ensure `firebase.json` and `storage.rules` are in project root.

### Admin panel still accessible without auth

**Solution:** Clear browser cache, redeploy app:
```bash
npm run build
firebase deploy --only hosting
```

### "Cannot access camera" error

**Solution:** 
- HTTPS required for camera access
- Check browser permissions
- Mobile: Ensure camera permission granted

### Storage upload fails

**Solution:**
1. Check Firebase Console → Storage tab
2. Ensure storage is enabled
3. Deploy storage rules: `firebase deploy --only storage`
4. Verify user is signed in (not guest)

### Duplicate detection not working

**Solution:**
- Ensure card database is synced
- Check browser console for errors
- Verify Firestore indexes (check console for index creation links)

### Admin script fails

**Solution:**
```bash
# Ensure firebase-admin-key.json exists
ls firebase-admin-key.json

# Reinstall firebase-admin
npm install firebase-admin

# Run with full path
node scripts/add-admin-user.js add <UID>
```

## Next Steps (Not Yet Implemented)

### Phase 2 Features
- [ ] Admin moderation dashboard (AdminSubmissions.jsx)
- [ ] OCR integration (Tesseract.js for code extraction)
- [ ] Reverse image search (Google Vision API)
- [ ] User submission history page
- [ ] Email notifications for approved/rejected submissions

### Phase 3 Features
- [ ] "Special" pseudo-set for promos/variants
- [ ] Periodic scraper for starwarsunlimited.com
- [ ] Auto-approval for high-confidence submissions
- [ ] Bulk import from official site
- [ ] Migration from swu-db.com to official site as primary source

### Research Script

Test official site structure:
```bash
cd SWU-Holocron
node scripts/research-official-api.js
```

This will:
- Find Next.js BUILD_ID
- Test API endpoints
- Validate CDN image patterns
- Generate recommendations for scraping

Output saved to `research-results.json`.

## Support

For issues or questions:
1. Check browser console for errors
2. Review Firebase Console logs
3. Verify Firestore security rules allow access
4. Check this README's troubleshooting section

## Additional Resources

- Firebase Storage Documentation: https://firebase.google.com/docs/storage
- Firebase Admin SDK: https://firebase.google.com/docs/admin/setup
- Official Card Site: https://starwarsunlimited.com/cards
- SWU-DB API: https://api.swu-db.com
