# User Management — Design

**Date:** 2026-10-05
**Status:** Draft, awaiting review

## Goal

From the admin console, see and search the app's users, see what each one has
been doing, and grant or revoke Pro and Contributor, without opening the
Firebase console.

## Decisions

| Question | Decision |
|---|---|
| Activity | Sign-ins plus what we already store (collection, batches, decks, last scan day); no new tracking (option B) |
| Roles from the app | **Pro and Contributor only.** Admin stays Firebase-console-only, so an admin session in the app can never create or remove admins (option A) |
| Guests | Listed behind a "Show guests" toggle; can't hold roles (as invite codes already enforce) |
| Audit | Every role change recorded at `artifacts/{APP_ID}/admin/audit/roleChanges/{auto}` |
| Where it runs | Three admin-only Cloud Functions (`onCall`), deployed by hand like `scanCard` |

## Why Cloud Functions

- **The user list:** Firebase Auth can be listed only through the Admin SDK. The client cannot list accounts or read another user's sign-in times.
- **Roles:** `firestore.rules` forbids any client from touching `isAdmin`, `isContributor` or `isPro`. That guard exists to stop self-promotion, so only server code may grant a role.
- **Activity:** reading another user's collection, batches and decks also needs the Admin SDK, because the rules give a client only its own subcollections.

## Architecture

### 1. `functions/adminUsers.js`

This file requires no package. Firestore, Auth, `HttpsError` and the clock are injected, as in `scanCard.js`, so the app's Vitest suite can test it in CI.

`createAdminUsersHandlers({ db, auth, appId, HttpsError, now })` returns `{ listUsers, getUserDetail, setRole }`. Each handler takes the `onCall` request.

**The admin gate.** Every handler first checks:
- that `request.auth` is present;
- that the caller is not anonymous;
- that `users/{callerUid}` has `isAdmin === true`.

Otherwise it throws `permission-denied`.

**`listUsers({ includeGuests = false })`** returns `{ users }`:
- **Accounts:** it pages through `auth.listUsers(1000, pageToken)`.
- **Roles:** it reads every `users/{uid}` profile with `db.getAll`, in chunks of 100.
- **Each user** looks like this:

  ```js
  { uid, email, displayName, provider: 'google' | 'guest' | 'other',
    createdAt, lastSignInAt, lastActiveAt,   // ms; lastActiveAt = metadata.lastRefreshTime ?? lastSignInTime
    roles: { isAdmin, isContributor, isPro } }
  ```

- **Order and filtering:** it sorts by `lastActiveAt`, most recent first, and leaves out guests unless `includeGuests` is set. Search and role filters run in the browser over this list.
- **Scale:** this is fine up to a few thousand accounts, comfortably beyond today's user base.

**`getUserDetail({ uid })`** returns:

```js
{ user,                                   // as in listUsers
  collection: { unique, total, lastChangedAt },  // count() + sum('quantity') aggregation; latest by `timestamp`
  batches: { count, latest: { name, createdAt, cards } | null },
  decks: { count },
  scans: { lastDay, count } | null,       // scanUsage/{uid}: { date, count }
  roleChanges: [ …last 10 for this uid, newest first ] }
```

- **Aggregations:** it uses the Admin SDK's `count()` and `sum()`, so no card documents are downloaded.
- **Errors:** an unknown uid returns `not-found`.

**`setRole({ uid, role, value })`:**
- `role` must be `'isPro'` or `'isContributor'`; anything else, including `isAdmin`, returns `invalid-argument`.
- `value` must be a boolean.
- **Rejected targets:**
  - a guest (`failed-precondition`, "Guest accounts can't hold roles");
  - an unknown uid (`not-found`).
- **The write:** it merges `{ [role]: value }` into `users/{uid}`, then adds the audit entry `{ uid, email, role, from, to, byUid, byEmail, at }`.
- **Same value:** if the value is unchanged it returns `{ ok: true, unchanged: true }` and writes no audit entry.

`functions/index.js` exports `adminListUsers`, `adminGetUserDetail` and `adminSetRole`, each with `onCall({ maxInstances: 2 })`.

### 2. Client: `src/services/UserAdminService.js`

- Thin `httpsCallable` wrappers for the three functions: `listUsers`, `getUserDetail` and `setRole`.
- They never throw; they return `{ error }`. A `permission-denied` error maps to "Admins only".

### 3. Admin console: a **Users** tab (`AdminUsers.jsx`, admins only)

**The list:**
- A search box (email, name or uid), a role filter (All, Pro, Contributor, Admin) and a **Show guests** toggle.
- **Rows** show:
  - the name or email;
  - a Google or Guest badge;
  - the join date;
  - "active 3 h ago", using relative time;
  - role badges.
- A count line, e.g. "42 users · 6 Pro · 2 contributors".

**The detail panel** (tap a row):
- the user's identity and dates;
- their activity (collection, batches, decks and last scan day);
- **Pro** and **Contributor** switches;
- the user's recent role changes.

Each switch asks "Make <name> Pro?" (or "Remove Pro from <name>?") before calling `setRole`, then refreshes the panel and that row. Admin shows as a read-only badge with the note "Admin is changed in the Firebase console". A guest shows the switches disabled, with the reason.

**Note shown after a change:** "<name> sees the change next time they open the app." The client reads roles at sign-in; server checks such as the scanner's Pro gate apply immediately.

### 4. Rules

No change. The functions use the Admin SDK, and `admin/**` is already readable by admins and writable only by server code. A rules test asserts that a non-admin cannot read `admin/audit/roleChanges`, and that no client, including an admin, can write it.

## Error handling

| Case | Behaviour |
|---|---|
| Caller not an admin, or a guest | `permission-denied`; tab shows "Admins only" |
| Functions not deployed yet | Tab shows "User management isn't deployed yet" (the `not-found` / `internal` from the callable) |
| Role change on a guest | Refused server-side; switches disabled client-side |
| Attempt to change `isAdmin` | Refused server-side (`invalid-argument`); no UI for it |
| A user's activity can't be read (e.g. no collection) | That section shows zeros or "—", never an error for the whole panel |

## Testing

- **`src/test/functions/adminUsers.test.js`** (fake Auth and Firestore):
  - the admin gate: non-admin, guest and unauthenticated callers are refused;
  - `listUsers` merges roles, sorts by activity, hides guests by default and pages through Auth;
  - `getUserDetail` aggregates and handles missing data;
  - `setRole` grants and revokes, records the audit entry, refuses `isAdmin` and guests, and handles an unchanged value.
- **`UserAdminService` tests:** errors are mapped, never thrown.
- **`AdminUsers.test.jsx`:**
  - search, the role filter and the guests toggle;
  - the detail panel's sections;
  - a toggle confirms, then calls `setRole` and refreshes;
  - Admin is read-only;
  - guest switches are disabled.
- **Rules test:** `admin/audit` is readable by admins only, and no client can write it.
- **Manual:**
  - deploy the functions;
  - grant Pro to a test account, then check it can scan after reloading;
  - revoke it;
  - check the audit entry appears.

## Out of scope

- Granting or revoking Admin.
- Disabling or deleting accounts, editing user data, impersonating users and bulk changes.
- Per-action activity logs and weekly scan totals (only today's scan count is stored).
