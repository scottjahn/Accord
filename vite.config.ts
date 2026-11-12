import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works at any URL: a domain root, a
  // sub-path such as GitHub Pages' /Accord/, or a folder on a home server.
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 60_000,
  },
});
