import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // happy-dom supplies `window`, `crypto.subtle`, and `localStorage`
    // which the wallet/* tests require. Pure-Node tests still pass
    // under happy-dom (it's a superset).
    environment: 'happy-dom',
  },
});
