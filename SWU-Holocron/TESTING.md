# SWU Holocron - Testing & CI/CD Documentation

## Overview

This document describes the comprehensive testing infrastructure and CI/CD pipeline for SWU Holocron, a Star Wars Unlimited TCG collection tracker.

## Project Structure

```
src/
├── utils/              # Pure utility functions (100% test coverage target)
│   ├── csvParser.js
│   ├── statsCalculator.js
│   └── collectionHelpers.js
├── services/
│   └── CardService.js
├── components/
│   ├── Dashboard.jsx
│   ├── CardModal.jsx
│   └── LandingScreen.jsx
├── test/
│   ├── setup.js                    # Test configuration
│   ├── utils/
│   │   ├── mockData.js            # Test fixtures
│   │   ├── csvParser.test.js
│   │   ├── statsCalculator.test.js
│   │   └── collectionHelpers.test.js
│   ├── components/
│   │   ├── Dashboard.test.jsx
│   │   └── CardModal.test.jsx
│   └── integration/
│       ├── csvImport.test.js
│       ├── collectionSync.test.js
│       └── offlineMode.test.js
```

## Testing Stack

- **Test Runner**: Vitest 1.6.0 (fast, Vite-native)
- **Test Environment**: happy-dom (faster than jsdom)
- **React Testing**: @testing-library/react 14.0
- **Coverage**: @vitest/coverage-v8

## Test Categories

### 1. Unit Tests (`@unit @critical`)
**Target**: 80% coverage on critical paths
**Execution Time**: <100ms per suite
**Location**: `src/test/utils/**/*.test.js`

Tests pure functions with no external dependencies:
- CSV parsing and generation
- Statistics calculation
- Collection ID generation
- Data transformation utilities

**Run**: `npm run test:unit`

### 2. Component Tests (`@component`)
**Target**: 70% coverage
**Execution Time**: <200ms per test
**Location**: `src/test/components/**/*.test.jsx`

Tests React components with mocked dependencies:
- Dashboard rendering and interactions
- CardModal quantity controls
- LandingScreen form handling

**Run**: `npm test -- --testNamePattern="@component"`

### 3. Integration Tests (`@integration @slow`)
**Target**: Key user flows
**Execution Time**: <2s per test
**Location**: `src/test/integration/**/*.test.js`

Tests complete workflows:
- CSV import/export round-trip
- Collection sync (sync code vs guest mode)
- Offline data reconstruction
- Firebase batch operations
- **Advanced search/filtering** (`advancedSearch.test.js`) - 35+ test cases covering:
  - Multi-criteria filtering (search + aspect + type + set)
  - Cross-set search behavior
  - Multi-aspect card handling
  - Edge cases and performance testing

**Run**: `npm run test:integration`

## Environment Tags

Tests are tagged to identify platform-specific code requiring React Native migration:

- `@environment:web-file-api` - Browser File API (CSV import/export)
- `@environment:firebase` - Firebase/Firestore operations
- `@environment:firebase-emulator` - Requires Firebase emulator
- `@environment:web-localstorage` - localStorage (→ AsyncStorage in RN)

## Running Tests

```bash
# Install dependencies
npm install

# Run all tests with coverage
npm run test:ci

# Run in watch mode (development)
npm test

# Run only unit tests (fast)
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests for changed files only
npm run test:changed

# Open coverage UI
npm run test:ui
```

## Coverage Thresholds

Configured in `vite.config.js`:

| Path | Lines | Functions | Branches | Statements |
|------|-------|-----------|----------|------------|
| `src/services/` | 80% | 80% | 80% | 80% |
| `src/utils/` | 80% | 80% | 80% | 80% |
| `src/components/` | 70% | 70% | 70% | 70% |

## Git Hooks (Husky)

### Pre-commit Hook
**Purpose**: Fast quality checks before commit
**Execution Time**: <5s
**Actions**:
1. Run ESLint on staged files
2. Run Prettier formatting
3. Run related unit tests for changed files

**Setup**:
```bash
npm run prepare  # Initialize Husky
```

### Pre-push Hook
**Purpose**: Ensure tests pass before pushing
**Execution Time**: <10s
**Actions**:
1. Run all unit tests
2. Verify no lint errors

## CI/CD Pipeline (GitHub Actions)

### Stage 1: Unit Tests (gates PR merge)
**Trigger**: On every PR and push to main
**Execution Time**: ~2-3 minutes
**Jobs**:
- Install dependencies (cached)
- Run linting
- Run unit tests in parallel
- Generate coverage report
- Upload to Codecov

**Configuration**: `.github/workflows/ci.yml`

```yaml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
          flags: unit
```

### Stage 2: Integration Tests (post-merge or nightly)
**Trigger**: After merge to main, or nightly cron
**Execution Time**: ~5-10 minutes
**Jobs**:
- Run integration tests
- Test with Firebase emulator (optional)
- Generate full coverage report

## Codecov Integration

### Configuration (`.codecov.yml`)

```yaml
coverage:
  status:
    project:
      default:
        target: 80%
        threshold: 2%
    patch:
      default:
        target: 80%

comment:
  layout: "condensed_header, condensed_files, condensed_footer"
  require_changes: true

flags:
  unit:
    paths:
      - src/utils/
      - src/services/
  integration:
    paths:
      - src/
```

### Badge
Add to README.md:
```markdown
[![codecov](https://codecov.io/gh/YOUR_USERNAME/SWU-Holocron/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_USERNAME/SWU-Holocron)
```

## Writing New Tests

### Unit Test Template

```javascript
/**
 * @vitest-environment happy-dom
 * @unit @critical
 */

import { describe, it, expect } from 'vitest';
import { yourFunction } from '../../utils/yourModule';

describe('yourFunction', () => {
  it('should handle normal case', () => {
    const result = yourFunction('input');
    expect(result).toBe('expected');
  });

  it('should handle edge case', () => {
    expect(() => yourFunction(null)).toThrow('error message');
  });
});
```

### Component Test Template

```javascript
/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import YourComponent from '../../components/YourComponent';

describe('YourComponent', () => {
  it('should render correctly', () => {
    render(<YourComponent prop="value" />);
    expect(screen.getByText('value')).toBeInTheDocument();
  });
  
  it('should handle user interaction', () => {
    const onClickMock = vi.fn();
    render(<YourComponent onClick={onClickMock} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClickMock).toHaveBeenCalledTimes(1);
  });
});
```

## React Native Migration Notes

### Tests Requiring Adaptation

1. **CSV Import/Export** (`@environment:web-file-api`)
   - Replace `File` API with `react-native-document-picker`
   - Replace `Blob` / `URL.createObjectURL` with `react-native-fs`
   - Update tests to mock native modules

2. **localStorage** (`@environment:web-localstorage`)
   - Replace with `@react-native-async-storage/async-storage`
   - Update synchronous calls to async/await
   - Mock AsyncStorage in tests

3. **Image Loading**
   - Replace `<img>` with `react-native-fast-image`
   - Update lazy loading tests

4. **Firebase** (`@environment:firebase`)
   - No changes needed (Firebase SDK supports RN)
   - Ensure Firestore persistence enabled

### Migration Checklist

- [ ] Update all files tagged with `@environment:web-file-api`
- [ ] Convert localStorage to AsyncStorage
- [ ] Replace `<img>` with `<FastImage>`
- [ ] Update test mocks for native modules
- [ ] Set up detox for E2E testing in RN
- [ ] Update CI to test iOS/Android builds

## Troubleshooting

### Tests Timing Out
- Check for missing `await` on async operations
- Increase timeout in specific tests: `it('test', async () => { ... }, 10000)`

### Coverage Not Updating
- Clear coverage directory: `rm -rf coverage`
- Re-run with `npm run test:ci`

### Mocks Not Working
- Ensure mocks are defined in `src/test/setup.js`
- Check mock is before imports in test file

### Firebase Errors in Tests
- Firebase is mocked by default in `setup.js`
- For integration tests with emulator, start emulator first: `firebase emulators:start`

## Performance Benchmarks

| Test Suite | Target Time | Current Status |
|------------|-------------|----------------|
| Unit Tests (all) | <2s | ✅ 1.8s |
| Component Tests | <3s | ✅ 2.5s |
| Integration Tests | <10s | ✅ 8s |
| Full CI Pipeline | <5min | ✅ 4min |

## Continuous Improvement

### Weekly Reviews
- Check coverage trends on Codecov
- Identify slow tests (>500ms)
- Review failed test patterns

### Monthly Goals
- Maintain 80%+ coverage on critical paths
- Keep CI pipeline under 5 minutes
- Zero flaky tests

## Resources

- [Vitest Docs](https://vitest.dev/)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Codecov Docs](https://docs.codecov.com/)
- [Husky Docs](https://typicode.github.io/husky/)
