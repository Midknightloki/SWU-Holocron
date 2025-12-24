# Implementation Plan: Google SSO & Multi-User Architecture

**Goal:** Replace the current "Sync Key" system with robust Google Single Sign-On (SSO) to enable secure, multi-user support and prepare the application for a scalable product release.

**Context:** Currently, the app uses anonymous authentication combined with a shared "Sync Key" to partition data. This is insecure and prone to collisions. We will transition to standard Firebase Authentication (Google Provider) and migrate existing user data.

---

## 1. Architecture Changes

### Authentication
*   **Current:** `signInAnonymously` + Manual `syncCode` stored in LocalStorage.
*   **New:** `GoogleAuthProvider` via Firebase Auth.
*   **User Object:** Standard Firebase `User` object (`uid`, `email`, `displayName`).

### Data Storage
*   **Current Path:** `artifacts/{APP_ID}/public/data/sync_{syncCode}/{cardId}` (or `users/{anonUid}/collection`).
*   **New Path:** `users/{uid}/collection/{cardId}`.
*   **Profile Data:** `users/{uid}` (Document) for settings/metadata.

---

## 2. Migration Strategy (The "Claim" Flow)

To ensure users don't lose their data, we will implement a "Claim Data" flow on their first Google Login.

1.  **Detection:** When a user logs in with Google, check if they have a legacy `syncCode` in `localStorage`.
2.  **Prompt:** If found, ask: *"We found an existing collection (Sync Key: XYZ). Would you like to import it to your account?"*
3.  **Execution:**
    *   Read all documents from the old `sync_{syncCode}` path.
    *   Batch write them to the new `users/{googleUid}/collection` path.
    *   Clear the legacy `syncCode` from `localStorage`.

---

## 3. Implementation Steps

### Phase 1: Firebase Configuration
1.  **Console Setup:**
    *   Enable **Google** provider in Firebase Console -> Authentication -> Sign-in method.
    *   (Optional) Add authorized domains (localhost, production domain).

### Phase 2: Frontend Implementation
2.  **Create `AuthContext`:**
    *   Move auth logic out of `App.jsx` into `src/contexts/AuthContext.jsx`.
    *   Expose `user`, `loading`, `loginWithGoogle`, `logout`.
3.  **Create `LoginComponent`:**
    *   Replace the "Enter Sync Key" input on `LandingScreen` with a "Sign in with Google" button.
    *   Keep a "Guest Mode" (Anonymous) option if desired, but hide the Sync Key UI.
4.  **Implement `MigrationService`:**
    *   **File:** `src/services/MigrationService.js`
    *   **Function:** `migrateCollection(oldPath, newPath)`
    *   **Logic:**
        *   `getDocs(collection(db, oldPath))`
        *   `writeBatch(db)`
        *   Loop docs -> `batch.set(doc(db, newPath, doc.id), doc.data())`
        *   `batch.commit()`

### Phase 3: Backend & Security
5.  **Update Firestore Rules:**
    *   **File:** `firestore.rules`
    *   **Logic:**
        ```
        match /users/{userId}/{document=**} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
        ```
    *   *Note:* We may need temporary rules to allow reading the old `sync_` paths during migration.

### Phase 4: Refactoring `App.jsx`
6.  **Update Data Fetching:**
    *   Replace `getCollectionRef(user, syncCode)` with `getCollectionRef(user)`.
    *   Ensure `user.uid` is used as the root for all data operations.

---

## 4. Technical Considerations

*   **Batch Limits:** Firestore batches are limited to 500 operations. If a user has >500 cards, the migration script must chunk the writes.
*   **Offline Support:** Ensure `enableIndexedDbPersistence` is active so users can view data offline (though Auth requires online to refresh tokens eventually).
*   **Legacy Cleanup:** After a successful migration, we should ideally mark the old sync path as "migrated" or delete it to save space (optional for now).

## 5. User Experience (UX)
*   **Landing Screen:** Clean, modern "Welcome" screen with a prominent Google Login button.
*   **Loading States:** Handle the transition from "Guest" to "Authenticated" smoothly without flashing empty states.
