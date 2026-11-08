import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    // The detection engine is pure functions over DOM fixtures, so it runs
    // without a real browser. This is where the bulk of the coverage lives.
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
  },
});
