import { defineConfig } from 'vitest/config';

// Unit tests cover the pure core (src/core): no WebGL, no DOM, no IWSDK.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
