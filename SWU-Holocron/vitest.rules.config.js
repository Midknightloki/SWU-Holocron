import { defineConfig } from 'vitest/config';

/**
 * Firestore security-rules tests.
 *
 * Separate from the main suite because these require a running emulator:
 *   npm run test:rules   (starts the emulator via firebase emulators:exec)
 *
 * They are excluded from the default vitest run so a normal `vitest` without
 * an emulator does not fail.
 */
export default defineConfig({
  test: {
    include: ['src/test/rules/**/*.test.js'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    // The emulator is shared state: parallel files would race on the same
    // documents, so run them one at a time.
    fileParallelism: false,
  },
});
