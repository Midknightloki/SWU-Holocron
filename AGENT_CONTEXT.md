# 🤖 Agent Context Guide - SWU Holocron

> **For AI Agents & Developers**: Complete project context to understand the SWU Holocron codebase, architecture, current issues, and deployment process.

## Quick Navigation

- **First Time?** → Start with [Project Overview](#project-overview)
- **Need Setup?** → Go to [Development Setup](#development-setup)
- **Fixing Bugs?** → Check [Known Issues & Fixes](#known-issues--fixes)
- **Deploying?** → See [Deployment](#deployment)
- **Running Tests?** → Read [Testing](#testing)

---

## Project Overview

**SWU Holocron** is a React-based Progressive Web App (PWA) for managing Star Wars: Unlimited trading card collections.

### Key Facts

| Aspect | Details |
|--------|---------|
| **Repository** | https://github.com/Midknightloki/SWU-Holocron |
| **Hosting** | Docker on Nidavellir (192.168.1.30) via Watchtower |
| **Backend** | Firebase (Authentication, Firestore, Hosting) |
| **Frontend Framework** | React 18 + Vite + Tailwind CSS |
| **Testing** | Vitest with 80%+ coverage target |
| **CI/CD** | GitHub Actions for tests, Watchtower for deployment |
| **Status** | Production - actively maintained |

### User Perspective
- ✅ Manage card collections (track quantities per set)
- ✅ Import/export collections (Moxfield & Archidekt compatible)
- ✅ View statistics (completion %, playsets, missing cards)
- ✅ Search and filter cards
- ✅ Works offline with Firebase sync
- ✅ Install as PWA on desktop/mobile

---

## Architecture Overview

### Technology Stack

```
Frontend                          Backend                    DevOps
─────────                         ───────                    ──────
React 18                          Firebase Authentication    Docker (Alpine)
Vite (build)                       Cloud Firestore            Nginx (reverse proxy)
Tailwind CSS                       Firebase Hosting (alt)     Watchtower (auto-updates)
Lucide Icons                       Data Connect (type-safe)   GitHub Actions (CI)
Vitest (testing)
```

### Data Flow

```
User Action
    ↓
React Component
    ↓
CardService.js (API layer)
    ↓
Firebase SDK
    ↓
Firebase Services:
├─ Authentication (Google, Anonymous)
├─ Firestore Database (collections, sync)
└─ Cloud Storage (optional)
    ↓
Local Cache (localStorage)
```

### File Organization

```
SWU-Holocron/SWU-Holocron/
├── src/
│   ├── App.jsx                 # Main app with collection listener
│   ├── firebase.js             # Firebase config & initialization
│   ├── constants.js            # Game rules, set definitions
│   ├── contexts/
│   │   └── AuthContext.jsx     # Authentication state
│   ├── components/
│   │   ├── Dashboard.jsx       # Stats and overview
│   │   ├── CardModal.jsx       # Card detail view
│   │   ├── AdvancedSearch.jsx  # Search interface
│   │   ├── CardSubmissionForm.jsx  # Admin: submit new cards
│   │   ├── AdminPanel.jsx      # Admin controls
│   │   └── ...
│   ├── services/
│   │   ├── CardService.js      # ⭐ Critical: Card fetching & collection paths
│   │   └── MigrationService.js # Data migration utilities
│   ├── utils/
│   │   ├── csvParser.js        # CSV import/export (Moxfield/Archidekt)
│   │   ├── statsCalculator.js  # Collection statistics
│   │   ├── collectionHelpers.js # ID generation, collection utilities
│   │   ├── officialCodeUtils.js # Set code mapping
│   │   └── ...
│   └── test/
│       ├── setup.js            # Global test config
│       ├── utils/              # Utility tests
│       ├── services/           # Service tests
│       └── integration/        # Integration tests
├── docs/
│   ├── CARD-DATABASE-ARCHITECTURE.md
│   ├── IMPLEMENTATION-SUMMARY.md
│   ├── SWU-RULES-AND-FORMATS.md
│   └── ...
├── scripts/
│   ├── seedCardDatabase.js     # Populate Firestore with card data
│   └── verifyCardDatabase.js   # Check data integrity
├── Dockerfile                  # Multi-stage Docker build
├── nginx.conf                  # SPA routing config
├── vite.config.js             # Build config + tests
├── tailwind.config.js         # Styling
└── README-SETUP.md            # ⭐ Setup & deployment guide
```

---

## Known Issues & Fixes

### ✅ FIXED: January 24, 2026

#### Issue 1: Invalid Firestore Collection Path
**Error Message:**
```
Invalid collection reference. Collection references must have an odd number 
of segments, but artifacts/swu-holocron-v1/public/data/cardDatabase/sets has 6.
```

**Root Cause:** Firestore requires paths with alternating document/collection segments (odd total).  
Path was: `artifacts` → `APP_ID` → `public` → `data` → `cardDatabase` → `sets` (6 segments = WRONG)

**Fix Applied:** [src/services/CardService.js](./SWU-Holocron/src/services/CardService.js) lines 33-51
```javascript
// BEFORE (Wrong - 6 segments)
const setsRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'sets');

// AFTER (Correct - 5 segments with doc() wrapper)
const cardDbRef = doc(db, 'artifacts', APP_ID, 'public/data/cardDatabase');
const setsRef = collection(cardDbRef, 'sets');
```

**Status:** ✅ Committed in `4fd9fc8`

---

#### Issue 2: TypeError on Timer Object
**Error Message:**
```
Uncaught TypeError: Cannot create property '_unsub' on number '50'
```

**Root Cause:** `setTimeout()` returns a number (timer ID), but code tried to attach a function property.  
Can't do: `timerNumber._unsub = function`

**Fix Applied:** [src/App.jsx](./SWU-Holocron/SWU-Holocron/src/App.jsx) lines 210-228
```javascript
// BEFORE (Wrong - storing on timer)
const timer = setTimeout(() => {
  const unsub = onSnapshot(...);
  timer._unsub = unsub;  // ❌ Can't add properties to numbers
}, 0);

// AFTER (Correct - using closure variable)
let unsubscribe = null;
const timer = setTimeout(() => {
  unsubscribe = onSnapshot(...);  // ✅ Proper variable in closure
}, 0);
return () => {
  clearTimeout(timer);
  if (unsubscribe) unsubscribe();
};
```

**Status:** ✅ Committed in `4fd9fc8`

---

#### Issue 3: Missing Firestore Permissions
**Error Message:**
```
FirebaseError: Missing or insufficient permissions.
Error checking admin status: FirebaseError: Missing or insufficient permissions.
Collection sync error: FirebaseError: Missing or insufficient permissions.
```

**Root Cause:** Firestore rules didn't allow reading from `/artifacts/{appId}/public/data/cardDatabase`

**Fix Applied:** [firestore.rules](./SWU-Holocron/SWU-Holocron/firestore.rules)
```firestore
// Added new rule:
match /artifacts/{appId}/public/data/cardDatabase/{document=**} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

**Status:** ✅ Committed in `4fd9fc8`, needs Firebase Console deployment

---

### How to Identify These Issues

**Look for in browser console (F12):**
```javascript
// Bad signs:
✗ Invalid collection reference - 6 segments
✗ Cannot create property '_unsub' on number
✗ Missing or insufficient permissions
✗ Collection listener not active

// Good signs:
✓ Available sets from Firestore
✓ Setting up collection listener - uid: ...
✓ Loaded X cards from Firestore
✓ Collection updated: X items
```

---

## Development Setup

### Prerequisites
- Node.js 20+ ([download](https://nodejs.org/))
- npm (comes with Node)
- Git
- Firebase account (for backend)

### Initial Setup

```bash
# Clone and navigate
git clone https://github.com/Midknightloki/SWU-Holocron.git
cd SWU-Holocron/SWU-Holocron

# Install dependencies
npm install

# Initialize Git hooks (for pre-commit/pre-push checks)
npm run prepare

# Verify setup
npm run test:unit  # Should pass
npm run build      # Should complete successfully
```

### Running Locally

```bash
# Start dev server (auto-reloads on changes)
npm run dev
# Visit: http://localhost:5173

# In another terminal, run tests in watch mode
npm test
```

### Firebase Configuration

**File:** [src/firebase.js](./SWU-Holocron/SWU-Holocron/src/firebase.js)

Contains the Firebase configuration. The values are already filled in for the production project:
```javascript
const firebaseConfig = {
  apiKey: "...",
  authDomain: "swu-holocron-93a18.firebaseapp.com",
  projectId: "swu-holocron-93a18",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

**Environment Tags:**
- `@environment:firebase` - Code that uses Firebase (Firestore, Auth)
- `@environment:web-file-api` - CSV import/export
- `@environment:web-localstorage` - Local caching
- `@environment:react` - React-specific code

Useful for understanding dependencies and platform-specific concerns.

---

## Critical Components to Know

### 1. CardService.js (The Heart)
**File:** [src/services/CardService.js](./SWU-Holocron/SWU-Holocron/src/services/CardService.js)

Handles all card data operations:
- `getAvailableSets()` - Fetches sets from Firestore or API
- `fetchSetData(setCode)` - Loads card data (3 fallback strategies)
- `fetchWithTimeout()` - Safe API calls with timeout

**Key Firestore Paths:**
```
/artifacts/{APP_ID}/public/data/cardDatabase/sets/{setCode}/data
     └─ Contains: { cards: [...], totalCards: N, syncVersion: "...", lastSync: ... }
```

### 2. App.jsx (Main Component)
**File:** [src/App.jsx](./SWU-Holocron/SWU-Holocron/src/App.jsx)

Main React component handling:
- Collection data listening (Firestore onSnapshot)
- Card data loading per set
- User authentication state
- Collection data management

**Key Function:** `getCollectionRef()` (line 32)
- Returns Firestore collection reference for user's collection
- Switches between user-scoped and legacy sync code paths
- Critical for collection persistence

### 3. Firebase Configuration
**File:** [firestore.rules](./SWU-Holocron/SWU-Holocron/firestore.rules)

Security rules defining access permissions:
```firestore
// User-scoped collections
/artifacts/{appId}/users/{uid}/collection/*
  └─ User can read/write only their own collection

// Card database (shared, read-only)
/artifacts/{appId}/public/data/cardDatabase/*
  └─ All authenticated users can read

// Legacy sync collections (deprecated)
/artifacts/{appId}/public/data/sync_*/*
  └─ Read-only until Feb 1, 2025 (migration deadline)
```

---

## Testing

### Test Structure

```
src/test/
├── setup.js                    # Global config (mocks, matchers)
├── utils/
│   ├── csvParser.test.js      # CSV import/export
│   ├── statsCalculator.test.js # Statistics calculations
│   └── collectionHelpers.test.js # Collection utilities
├── components/
│   ├── Dashboard.test.jsx
│   ├── CardModal.test.jsx
│   └── ...
├── services/
│   └── CardService.test.js     # Card fetching logic
└── integration/
    ├── csvImport.test.js       # End-to-end CSV flow
    ├── collectionSync.test.js  # Firestore sync
    └── offlineMode.test.js     # Offline functionality
```

### Running Tests

```bash
# Watch mode (during development)
npm test

# Run once (CI mode)
npm run test:unit          # Just unit tests (fast)
npm run test:integration   # Just integration tests (slower)
npm run test:ci           # Everything with coverage

# Specific tests
npx vitest --grep "CardService"
npx vitest --grep "@environment:firebase"
```

### Coverage Targets

| Module | Target |
|--------|--------|
| `src/utils/` | 80% |
| `src/services/` | 80% |
| `src/components/` | 70% |

Run `npm run test:ci` to see actual coverage.

---

## Deployment

### Architecture

```
Git Push (GitHub/Gitea)
    ↓
Watchtower (on Nidavellir)
    ↓ (detects new commit every 5 min)
Docker Image Rebuild
    ├─ npm ci (install deps)
    ├─ npm run build (create dist/)
    └─ Build Nginx container
    ↓
Container Replace
    ├─ Stop old container
    └─ Start new container with health check
    ↓
Users See Update
    (after browser refresh/cache clear)
```

### Deployment Process

**Requirements:**
- Changes committed and pushed to Gitea
- Fresh build: `npm run build` succeeds locally
- Tests: `npm run test:ci` passes

**What Happens:**
1. You push code to Gitea
2. Watchtower detects changes (every 5 minutes)
3. Docker rebuilds image automatically
4. Container restarts with new code
5. Health check verifies it's healthy
6. Users see new version (after cache clear)

**Timeline:**
- Push to Watchtower detection: ~5 minutes
- Docker rebuild: ~2-3 minutes
- Total: 5-10 minutes until live

### Firestore Rules Deployment

**Separate from app code!** Rules are deployed manually:

1. Go to: https://console.firebase.google.com/project/swu-holocron-93a18/firestore
2. Click **Rules** tab
3. Click **Edit Rules**
4. Paste content from `firestore.rules`
5. Click **Publish**

### Verification Checklist

After deployment completes:

```bash
# 1. Browser console (F12) should show:
✓ Available sets from Firestore
✓ Setting up collection listener - uid: [user-id]
✓ Loaded X cards from Firestore (SOR)
✓ Collection updated: X items

# 2. No errors like:
✗ Invalid collection reference - 6 segments
✗ Cannot create property '_unsub' on number
✗ Missing or insufficient permissions

# 3. Functionality works:
- Log in
- Select a set
- Add cards to collection
- Refresh page - collection persists
```

### Rollback Procedure

If a deployment breaks things:

```bash
# 1. Identify bad commit
git log --oneline | head -5

# 2. Revert the commit
git revert <bad-commit-hash>

# 3. Push (Watchtower auto-deploys)
git push origin main

# Watchtower will auto-rebuild and redeploy (~5-10 min)
```

---

## Common Development Tasks

### Debugging Collection Issues

**Collection not loading?**
1. Open DevTools Console (F12)
2. Look for Firestore permission errors
3. Check if user is authenticated
4. Verify Firestore rules are deployed
5. Check Firestore database (Firebase Console)

**Example debug code:**
```javascript
// In browser console
firebase.auth().currentUser  // Should show user object
db  // Firestore instance from firebase.js
// Try basic collection read:
db.collection('artifacts').get()
```

### Changing Card Database Structure

**Files to update:**
1. `src/services/CardService.js` - Path logic
2. `firestore.rules` - Access permissions
3. Tests in `src/test/services/CardService.test.js`
4. Database seed script in `scripts/seedCardDatabase.js`

**Example: Adding new set data field**
```javascript
// In CardService.js
const docRef = doc(setsCollRef, setCode, 'data');
const docSnap = await getDoc(docRef);
const data = docSnap.data();
// Now includes new field:
console.log(data.newField);
```

### Adding New Features

**Typical flow:**
1. Create component in `src/components/`
2. Add tests in `src/test/components/`
3. Connect to CardService or AuthContext
4. Run tests: `npm test`
5. Pre-commit hook validates
6. Commit and push (tests gate merge in CI)

---

## Troubleshooting

### Tests Failing Locally

```bash
# Clear cache and reinstall
rm -r node_modules package-lock.json
npm install

# Clear Vitest cache
npx vitest --clearCache

# Run tests again
npm test
```

### Build Fails

```bash
# Check Node version (need 20+)
node --version

# Try clean build
npm run build -- --force

# Check for TypeScript errors
npx tsc --noEmit
```

### Firebase Connection Issues

```javascript
// Check if Firebase is initialized
console.log(db);      // Should be a Firestore instance
console.log(auth);    // Should be an Auth instance

// Try manual test
import { getDocs, collection } from 'firebase/firestore';
getDocs(collection(db, 'artifacts'))
  .then(snap => console.log('Connected!'))
  .catch(err => console.error('Error:', err));
```

### Git Hooks Not Running

```bash
# Reinstall hooks
npm run prepare

# Check if installed
ls -la .husky/  # Should show pre-commit, pre-push files

# Run hooks manually
npx husky install
```

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [README-SETUP.md](./SWU-Holocron/README-SETUP.md) | Deployment & testing guide |
| [TESTING.md](./SWU-Holocron/TESTING.md) | Test infrastructure details |
| [CARD-DATABASE-ARCHITECTURE.md](./SWU-Holocron/docs/CARD-DATABASE-ARCHITECTURE.md) | Database design |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Firebase deployment options |
| [DEPLOYMENT_STATUS.md](./DEPLOYMENT_STATUS.md) | Current deployment info |
| [FIREBASE_FIXES_APPLIED.md](./FIREBASE_FIXES_APPLIED.md) | Recent fixes explained |

---

## Key Contacts & Resources

### Internal Resources
- **Repository**: https://github.com/Midknightloki/SWU-Holocron
- **Firebase Project**: swu-holocron-93a18
- **Production Host**: Nidavellir (192.168.1.30)
- **Deployment Tool**: Watchtower

### External Resources
- **Firebase Docs**: https://firebase.google.com/docs
- **React Docs**: https://react.dev
- **Vite Docs**: https://vitejs.dev
- **SWU Rules**: https://www.starwarsunlimited.com
- **Card Database API**: https://api.swu-db.com

---

## Quick Reference

### Common Commands

```bash
# Development
npm run dev              # Start dev server
npm test                # Watch mode
npm run build           # Production build
npm run lint            # Check code style

# Testing
npm run test:ci         # Full test suite
npm run test:unit       # Fast unit tests
npm run test:changed    # Test only changed files

# Admin
npm run admin:seed-cards      # Populate card database
npm run admin:verify-db       # Check data integrity

# Git
git status              # See what changed
git add .               # Stage all changes
git commit -m "..."     # Commit
git push origin main    # Push to Gitea
```

### Firestore Paths Cheat Sheet

```
User Collections:
  /artifacts/{APP_ID}/users/{uid}/collection/{collectionId}
    └─ User's owned cards

Card Database:
  /artifacts/{APP_ID}/public/data/cardDatabase/sets/{setCode}/data
    └─ Card data for each set

Legacy (Deprecated):
  /artifacts/{APP_ID}/public/data/sync_{syncCode}/{collectionId}
    └─ Old shared collections (read-only)
```

### Firebase Rules Permissions

```
✓ User can read/write: /artifacts/{appId}/users/{uid}/*
✓ User can read: /artifacts/{appId}/public/data/cardDatabase/*
✓ User can read (until Feb 1): /artifacts/{appId}/public/data/sync_*/*
✗ User cannot write to card database (read-only)
```

---

## Future Agent Context

When you encounter issues not listed here:

1. **Check the docs** - See [Related Documentation](#related-documentation)
2. **Search the code** - Look for `@environment` tags
3. **Run tests** - `npm run test:ci` shows what works
4. **Check browser console** - F12 usually tells you the problem
5. **Review recent commits** - `git log --oneline` shows what changed
6. **Ask for help** - Include error message + steps to reproduce

---

**Last Updated:** January 24, 2026  
**Status:** ✅ All major issues fixed and documented  
**Version:** 1.0.0  

*This guide should be updated whenever major changes are made to the project.*

