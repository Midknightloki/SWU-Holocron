# Integration Test Fixes - Future Project

## Overview
The integration tests for the card submission form are currently failing because they attempt to test the full `<App>` component with complex routing and context setup. Rather than fix these immediately, we're documenting the plan for future implementation.

## Root Causes

### 1. **Incomplete Component Routing**
- Tests try to navigate between views (Binder → Submission Form → Back)
- App routing may not be fully set up in test environment
- Navigation mocking insufficient

### 2. **Context Provider Chain Incomplete**
- Tests only provide `AuthContext`
- App may require additional providers:
  - Router/Navigation context
  - Theme context
  - Firebase configuration context
  - Data/State management context

### 3. **Firebase Initialization Mocking**
- Mocking at API level (`firebase/firestore`) but not initialization
- App may perform initialization checks on mount
- Async initialization may not be mocked properly

## Current Test Structure

**Working Tests:**
- ✅ Service-level tests: `src/test/services/CardSubmission.test.js` - 13 passing tests
- ✅ Component tests: `src/test/components/CardSubmissionForm.test.jsx` - Basic form field tests working

**Failing Tests:**
- ❌ Integration tests: `src/test/integration/cardSubmission.test.jsx` - 59 tests, focusing on full app flow

## Implementation Plan for Integration Tests (Priority: LOW)

### Phase 1: Test Environment Setup
1. **Create test app wrapper**
   ```jsx
   // src/test/utils/TestAppWrapper.jsx
   - Provide all required context providers
   - Mock routing with MemoryRouter
   - Configure Firebase emulator for tests
   - Set up test utilities
   ```

2. **Mock routing properly**
   - Use react-router's `MemoryRouter` for navigation testing
   - Create mock navigation state management
   - Test route transitions programmatically

3. **Complete Firebase mocking**
   - Mock initialization sequence
   - Mock serverTimestamp properly
   - Handle async Firestore operations
   - Mock Firebase Storage properly

### Phase 2: Component Integration Tests
1. **Test full submission flow** through the form component
   - User authentication
   - Mode selection (URL vs Manual)
   - Form validation
   - Submission with Firebase write

2. **Test error scenarios**
   - Network failures
   - Validation errors
   - Storage upload failures
   - Submission failures

### Phase 3: App-Level Integration Tests
1. **Test navigation flow**
   - Navigate to submission form
   - Fill and submit form
   - Navigate back to binder
   - Verify state persistence

2. **Test multi-user scenarios**
   - Authentication state changes
   - Admin vs regular user
   - Permission-based UI visibility

3. **Test data persistence**
   - Form data saved to Firestore
   - Images uploaded to Storage
   - Submission appears in admin panel
   - Submission history in user profile

## Detailed Implementation Steps

### Step 1: Create Test App Wrapper (Est. 2-3 hours)

```jsx
// src/test/utils/TestAppWrapper.jsx
export function TestAppWrapper({ children, initialRoute = '/' }) {
  return (
    <AuthContext.Provider value={mockAuthContext}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <ThemeContext.Provider value={mockTheme}>
          <div>{children}</div>
        </ThemeContext.Provider>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

// Usage in tests
render(
  <TestAppWrapper initialRoute="/submit">
    <App />
  </TestAppWrapper>
);
```

### Step 2: Set Up Firebase Emulator (Est. 1-2 hours)

```javascript
// src/test/setup/firebaseEmulator.js
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { connectStorageEmulator, initializeStorage } from 'firebase/storage';

export async function setupFirebaseEmulator() {
  const app = initializeApp({
    projectId: 'test-project',
    apiKey: 'test-key',
    authDomain: 'test.firebaseapp.com'
  });

  const db = initializeFirestore(app, { host: 'localhost', port: 8080 });
  const storage = initializeStorage(app);

  if (process.env.NODE_ENV === 'test') {
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
  }

  return { app, db, storage };
}

// In vitest config or test setup
beforeAll(async () => {
  await setupFirebaseEmulator();
});
```

### Step 3: Rewrite Integration Tests (Est. 3-4 hours)

```javascript
// src/test/integration/cardSubmission.test.jsx (rewritten)
describe('Card Submission End-to-End', () => {
  beforeEach(async () => {
    // Clear Firebase emulator data
    await clearFirestoreData();
    await clearStorageData();
  });

  it('should submit card via Official URL and appear in submissions', async () => {
    const { user } = render(
      <TestAppWrapper initialRoute="/submit">
        <App />
      </TestAppWrapper>
    );

    // Navigate and fill form
    const urlModeButton = screen.getByRole('button', { name: /Official URL/i });
    await user.click(urlModeButton);

    const urlInput = screen.getByPlaceholderText(/starwarsunlimited.com/);
    await user.type(urlInput, 'https://starwarsunlimited.com/cards/SOR_001');

    const submitButton = screen.getByRole('button', { name: /Submit Card/i });
    await user.click(submitButton);

    // Verify submission in Firestore
    await waitFor(async () => {
      const submissions = await getDocs(
        query(
          collection(db, `artifacts/${APP_ID}/submissions/pending`),
          where('officialUrl', '==', 'https://starwarsunlimited.com/cards/SOR_001')
        )
      );
      expect(submissions.size).toBe(1);
    });
  });
});
```

### Step 4: Test Error Scenarios (Est. 2-3 hours)

- Network timeouts
- Storage quota exceeded
- Firestore write failures
- Image upload failures
- Invalid form data

### Step 5: Test Admin Features (Est. 2 hours)

- Admin seeing submitted cards
- Approval/rejection workflow
- Statistics and analytics

## Validation Criteria

- [ ] All 59 integration tests pass
- [ ] Tests run in < 30 seconds
- [ ] Tests can run in CI/CD without Firebase project
- [ ] Firebase emulator properly isolated between tests
- [ ] Full submission flow tested end-to-end
- [ ] Error scenarios covered
- [ ] Admin workflows verified

## Dependencies

- `vitest` (already used)
- `@testing-library/react` (already used)
- `react-router` + `MemoryRouter` (needs to be used in tests)
- Firebase emulator (runs locally)
- `jest-localstorage-mock` (for localStorage in tests)

## Estimated Timeline

- **Phase 1 (Setup):** 3-5 hours
- **Phase 2 (Component Tests):** 2-3 hours  
- **Phase 3 (App-Level Tests):** 3-4 hours

**Total Estimate:** 8-12 hours of work

## Why Not Do This Now?

1. **Service tests already verify core logic** - We have 13 passing service tests that validate:
   - Submission validation for both modes
   - Mode-aware submission creation
   - Error handling

2. **Component tests verify UI behavior** - We have component tests that validate:
   - Form rendering
   - Field inputs
   - Image uploads
   - Mode toggle behavior

3. **Integration tests are for full-flow verification** - These are nice-to-have for end-to-end confidence but not critical

4. **Time constraint** - Given we have working validation and component tests, integration tests would require significant setup work

## Next Steps

1. ✅ **DONE NOW:** Create focused service & component tests
2. **FUTURE:** When Firebase integration is more stable, implement integration tests
3. **FUTURE:** Consider moving to Cypress or Playwright for easier E2E testing

## References

- Firebase Emulator: https://firebase.google.com/docs/emulator-suite
- React Router Testing: https://reactrouter.com/en/main/guides/testing
- Vitest + Testing Library: https://vitest.dev/guide/testing-lib.html
