import { defineConfig } from 'vitest/config';

// GitHub Pages serves the game from /<repo>/, so assets need that base path in production builds.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/airrough-like/' : '/',
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
