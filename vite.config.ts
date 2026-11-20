import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Version and build id shown in bug-report info: "v0.1.0" for releases, "0.1.0+abc1234" for main builds.
const id = process.env.BUILD_ID || process.env.GITHUB_SHA || '';
const build = id.startsWith('v') ? id : `${pkg.version}+${id.slice(0, 7) || new Date().toISOString().slice(0, 10)}`;

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
