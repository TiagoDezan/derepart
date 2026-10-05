import { defineConfig } from 'tsup';

// Bundles the API (and the workspace package @derepart/shared) into dist/.
// Migrations stay in ./drizzle and are applied at start-up.
export default defineConfig({
  entry: { index: 'src/index.ts', seed: 'src/scripts/seed.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@derepart/shared'],
});
