# SWU Holocron - AI Coding Guidelines

## Project Overview
A virtual binder and collection tracker for the "Star Wars Unlimited" TCG. React web app (Vite + Firebase + Tailwind) with planned React Native migration documented in [SWU Holocron - React Native Migration Context.md](../SWU Holocron - React Native Migration Context.md).

## Design Philosophy (Requirement #1)

### Data Flow Strategy (Critical)
Three-tier "Seed and Store" data fetching strategy to minimize API load and ensure complete database
### 1. Complete Database (Non-Negotiable)
**Problem**: Apps with incomplete card databases are useless.  
**Solution**: Three-tier "Holocron Pattern" with aggressive caching and fallback strategies ensures card data is always available, even offline.

### 2. Unified Collection Management
**Problem**: Other apps separate "browsing cards" from "managing collection" - but they're the same thing. Cards in the database are just cards you don't own yet.  
**Solution**: Collection controls (+/- quantity, foil toggle) are embedded directly in:
- Card grid (hover overlay with counters)
- Card modal (persistent header controls)
- Dashboard missing cards table (add button)

Never navigate away from card view to update collection.

### 3. Smart Collection Analysis
**Problem**: Users shouldn't need Excel to figure out which cards they need.  
**Solution**: [Dashboard.jsx](../src/components/Dashboard.jsx) automatically calculates:
- Unique card completion percentage
- Playset counts (3x units, 1x leaders)
- Missing cards table with one-click add
- Export missing cards as CSV for shopping lists

### 4. Cross-Platform & Multi-Device
**Problem**: Collection data must work on phone, tablet, and laptop.  
**Solution**: Firebase real-time sync with low-friction authentication. Options:
- **Guest Mode**: Anonymous auth, device-specific (prototype baseline)
- **Sync Codes**: Simple string-based sharing (prototype workaround for single-file constraints)
- **Google Sign-In** (recommended for refactored version): Frictionless OAuth with persistent identity

**Core Principle**: Minimize authentication barriers. Users should access their collection in seconds, not navigate multi-step signup flows.

## Architecture: The "Holocron Pattern"

### Data Flow Strategy (Critical)
Three-tier "Seed and Store" data fetching strategy to minimize API load:

1. **Local Cache First**: Check `localStorage` for cached set data (`swu-cards-${setCode}`)
2. **Cloud Holocron Second**: Check shared Firestore public path: `/artifacts/{appId}/public/data/sets/{setCode}` (7-day cache)
3. **API as Seeding Sourcepaths based on authentication method:
- **Guest Mode**: `/artifacts/{appId}/users/{uid}/collection` (anonymous Firebase Auth, device-specific)
- **Sync Code Mode** (prototype): `/artifacts/{appId}/public/data/sync_{SYNC_CODE}` (shared via memorable string)
- **Authenticated Mode** (recommended): `/artifacts/{appId}/users/{uid}/collection` (Google/OAuth UID, persistent)

Document IDs: `${SetCode}_${CardNumber}_${isFoil ? 'foil' : 'std'}` (see `CardService.getCollectionId()`)

**Migration Note**: Sync codes were a single-file prototype workaround. Prefer proper OAuth (Google Sign-In) for the refactored app, but maintain the low-friction principle - users should click one button and be in their collection, not fill out forms
- **Guest Mode**: `/artifacts/{appId}/users/{uid}/collection` (anonymous Firebase Auth, device-specific)

Document IDs: `${SetCode}_${CardNumber}_${isFoil ? 'foil' : 'std'}` (see `CardService.getCollectionId()`)

**Key Insight**: Sync codes enable frictionless multi-device access without account creation. User just remembers their code (e.g., "jedi-master-42").

## Critical Patterns

### Firebase Configuration
[src/firebase.js](../src/firebase.js) uses placeholder values by default. Check `isConfigured` flag before Firebase operations. App degrades gracefully when Firebase is unconfigured.

**Runtime Injection Pattern**: Original prototype supported runtime config via global variables:
- `__firebase_config`: JSON string with Firebase config
- `__app_id`: Custom app identifier for Firestore paths
- `__initial_auth_token`: Custom auth token (falls back to anonymous auth)

This pattern may be useful for deployment flexibility (e.g., injecting config at build time).

### CORS Proxy Rotation
Web limitation: [CardService.js](../src/services/CardService.js) rotates through 4 proxy strategies:
- `allorigins.win`, `corsproxy.io`, `codetabs.com`, then direct fetch
- **React Native Note**: This logic should be removed entirely (no CORS in native apps)

### Collection State Management
Real-time sync via Firestore `onSnapshot()` in [app.jsx](../src/app.jsx). Collection data stored as flat object: `{ [docId]: CollectionItem }`

Path resolution: `getCollectionRef(user, syncCode)` helper determines Firestore path based on sync state.

**Offline Reconstruction**: When network fails, app reconstructs card data from collection metadata (see prototype's `reconstructedData` state). Each collection item stores `{ set, number, name, quantity, isFoil, timestamp }` enabling basic card listing even when API is unreachable.

**Batch Write Pattern**: CSV imports use Firestore `writeBatch()` with 400-operation chunks to avoid limits:
```javascript
let batch = writeBatch(db);
let opCount = 0;
// ... operations
if (opCount >= 400) { await batch.commit(); batch = writeBatch(db); opCount = 0; }
```

### Component Structure (In Progress)
Currently monolithic [app.jsx](../src/app.jsx) (157 lines). Components extracted: (Requirement #3)
- [CardModal.jsx](../src/components/CardModal.jsx): Card detail view with inline collection controls (Requirement #2)

**Pattern**: All components receive collection update functions as props; no context/store yet.

**Critical**: Collection management must remain inline. Don't create separate "collection management" screens/modals - violates core design principle #2

**Pattern**: All components receive collection update functions as props; no context/store yet.

## Developer Workflows

### Build & Run
```bash
npm run dev      # Vite dev server (port 5173)
npm run build    # Production build
npm run preview  # Preview production build
```

### Data Constants
[src/constants.js](../src/constants.js) defines:
- `SETS`: Available card sets with codes (e.g., `SOR`, `SHD`)
- `ASPECTS`: Game aspects with Lucide icons and Tailwind colors
- `FALLBACK_DATA`: Emergency fallback cards when offline

### Testing Data Flow
1. Clear `localStorage` key `swu-cards-${setCode}` to force re-fetch
2. Test offline: Disable Firestore in [firebase.js](../src/firebase.js) to trigger fallback logic
3. Collection sync: Use "Sync Code" in UI to share collection across browser sessions

## Migration Context (React Native)

### Platform-Specific Changes Required
1. **Remove CORS proxies**: Direct `fetch()` to `api.swu-db.com`
2. **Replace `localStorage`**: Use `AsyncStorage` for card database caching
3. **Replace `<input type="file">`**: Use `react-native-document-picker` + `react-native-fs` for CSV import/export
4. **Replace grid layout**: Use `FlatList` with `numColumns` for card binder
5. **Image optimization**: Use `react-native-fast-image` for aggressive caching
- **Card Layout**: Horizontal cards (Leaders/Bases) use `aspect-[88/63]` and `col-span-2`, vertical cards use `aspect-[63/88]`
- **CSV Parsing**: Handle quoted fields with regex: `split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)`
- **LocalStorage Keys**: Use prefixed pattern (`swu-cards-${setCode}`, `swu-sync-${setCode}`, `swu-sync-code`, `swu-has-visited`)

See full checklist in [SWU Holocron - React Native Migration Context.md](../SWU Holocron - React Native Migration Context.md).

## Code Style & Conventions

- **Imports**: Lucide icons at top, local imports follow
- **State naming**: Use descriptive booleans (`isGuestMode`, `hasVisited`) with localStorage persistence
- **Error handling**: Graceful degradation (show fallback data, not crashes)
- **Firestore operations**: Always check `db` existence before use
- **Styling**: Tailwind classes with dark theme (`bg-gray-950`, `text-gray-100` base)

## Key Files Reference
- [app.jsx](../src/app.jsx): Main app logic, auth flow, view routing
- [CardService.js](../src/services/CardService.js): Data fetching, caching, image UR
- [Prototype/app.jsx](../Prototype/app.jsx): Original single-file implementation (reference for full integration patterns)

## UI/UX Patterns

### Foil Card Effect
Prototype includes CSS shimmer animation for foil cards:
- `animate-shimmer` with gradient overlay
- `mix-blend-color-dodge` for holographic effect
- Applied conditionally when `isFoil` state is true

### Collapsible Header
Header expands/collapses to maximize screen space for card grid:
- Toggle via `isHeaderExpanded` state
- Animated with `max-h-[500px]` transition
- Filters hidden when collapsed

### Collection Count Display
Grid cards show dual count format: `std` + `foilF` (e.g., "3 +2F")
- Standard count displayed prominently
- Foil count as smaller yellow badge
- Controls fade in on hover when count is 0Ls
- [firebase.js](../src/firebase.js): Firebase config, exports `isConfigured` flag
- [constants.js](../src/constants.js): Sets, aspects, fallback data
- [Dashboard.jsx](../src/components/Dashboard.jsx): Collection stats, CSV operations
