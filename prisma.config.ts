import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

// Uses the JS-based schema engine (driver adapter) for Prisma CLI operations.
// The app runtime also uses PrismaPg — see src/models/index.ts.
export default defineConfig({
  schema: './prisma/schema.prisma',
  experimental: { adapter: true },
  engine: 'js',
  adapter: async () => new PrismaPg({ connectionString: process.env['DATABASE_URL']! }),
});
