import { defineConfig } from 'vitest/config';

// Build id shown in bug-report info: the commit (CI passes BUILD_ID / GITHUB_SHA), else the build date.
const build = (process.env.BUILD_ID || process.env.GITHUB_SHA || '').slice(0, 7) || new Date().toISOString().slice(0, 10);

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
