import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` creates SQL migrations in ./drizzle from src/db/schema.ts.
// They are applied automatically at API start-up (src/db/client.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
