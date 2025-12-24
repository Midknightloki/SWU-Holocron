# Copilot Instructions & TODOs

This file tracks outstanding tasks and provides context for GitHub Copilot assistance.

## Completed Tasks ✅

### Advanced Search Component Test Coverage (2025-12-24)
- **Status**: ✅ COMPLETED
- **Description**: Created comprehensive test suite for advanced search/filtering functionality
- **File**: `src/test/integration/advancedSearch.test.js`
- **Coverage**: 
  - Multi-criteria filtering (search + aspect + type + set)
  - Cross-set search behavior
  - Multi-aspect card handling
  - Case sensitivity
  - Empty results scenarios
  - Edge cases (null cards, missing properties)
  - Card type filtering (Unit, Event, Leader, Base)
  - Performance testing with large datasets
  - Subtitle and text search
- **Test Count**: 35+ test cases across 11 test suites
- **Lines**: 600+ lines of test code

## Pending Tasks 📋

### High Priority - IMMEDIATE ACTION REQUIRED ⚠️
- [ ] **Run test suite to validate all tests pass** - Could not be completed due to PowerShell 6+ requirement
  - Command: `npm test advancedSearch.test.js`
  - Expected: All 35+ tests should pass
  - If failures occur: Review error messages and see troubleshooting in `docs/ADVANCED-SEARCH-TESTS.md`
  - **Max 3 iterations to fix** - if not resolved, document issue below
- [ ] Verify test coverage meets 80% threshold for integration tests
- [ ] Implement global search functionality (see `src/test/integration/globalSearch.test.js` for requirements)
- [ ] Add search debouncing to improve performance

### Medium Priority  
- [ ] Add component-level tests for search UI components
- [ ] Test CSV import/export with filtered results
- [ ] Add accessibility tests for search/filter controls
- [ ] Test keyboard navigation for filters

### Low Priority
- [ ] Add visual regression tests for search results
- [ ] Performance benchmarking for searches on 1000+ cards
- [ ] Add telemetry for search usage patterns

## Code Quality Notes

### Test Organization
The test suite is organized by functionality:
1. **Multi-Criteria Filtering**: Tests combining search, aspect, type, and set filters
2. **Cross-Set Search**: Tests behavior when switching between sets
3. **Multi-Aspect Cards**: Tests cards with multiple aspects (e.g., Heroism + Cunning)
4. **Case Sensitivity**: Ensures search is case-insensitive
5. **Empty Results**: Tests edge cases where filters return no results
6. **Edge Cases**: Tests null handling, missing properties, etc.
7. **Card Type Filtering**: Tests filtering by Unit, Event, Leader, Base
8. **Performance**: Tests with large datasets (1000+ cards)
9. **Subtitle and Text Search**: Tests searching in card subtitle and text fields

### Testing Best Practices Used
- ✅ Descriptive test names that explain expected behavior
- ✅ Comprehensive mock data representing real card structures
- ✅ Tests for both happy paths and edge cases
- ✅ Performance assertions (< 50ms for 1000 cards)
- ✅ Isolated test cases with no interdependencies
- ✅ BeforeEach hooks for clean setup

### Known Issues
- **PowerShell 6+ not available in current environment** - Prevented running tests directly
  - Tests were created and validated structurally
  - Need manual test execution: `npm test advancedSearch.test.js`
  - Validation scripts created as workaround: `validate-tests.js`, `analyze-tests.js`
- Need to validate tests pass before merging (max 3 iterations)
- Consider adding visual component tests using Testing Library

## Related Files
- `src/App.jsx` - Contains the filtering logic being tested (lines 354-365)
- `src/test/integration/setFiltering.test.js` - Related set filtering tests
- `src/test/integration/globalSearch.test.js` - Placeholder for global search feature
- `src/constants.js` - SETS and ASPECTS constants used in filtering
- `TESTING.md` - Main testing documentation

## Future Enhancements

### Search Improvements
1. **Full-Text Search**: Search across card name, subtitle, and text
2. **Search History**: Remember recent searches
3. **Advanced Filters**: Cost range, power/HP filters, rarity
4. **Saved Searches**: Save filter combinations
5. **Quick Filters**: One-click filters for common queries

### Test Improvements
1. **Snapshot Testing**: For filter UI components
2. **E2E Tests**: Full user workflows with search
3. **Load Testing**: Search performance with 10,000+ cards
4. **Mobile Testing**: Touch interactions with filters

## Notes for Future Developers

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test advancedSearch.test.js

# Run with coverage
npm run test:ci

# Validate test structure
node validate-tests.js
```

### Adding New Tests
1. Add test cases to appropriate describe block
2. Use existing mock data structure in beforeEach
3. Follow naming convention: "should [expected behavior] when [condition]"
4. Include edge cases and error scenarios
5. Keep tests independent and isolated

### Debugging Failed Tests
1. Check mock data structure matches actual card structure
2. Verify filter logic matches implementation in App.jsx
3. Use `console.log` in test for debugging filter results
4. Check for async issues if tests are flaky
