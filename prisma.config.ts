import { defineConfig } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  // URL used by Prisma CLI (migrate dev, db push, studio, etc.)
  // The app passes its own URL via PrismaClient constructor — see src/models/index.ts.
  // For migrations in the test environment, set DATABASE_URL to TEST_DATABASE_URL before running.
  datasourceUrl: process.env.DATABASE_URL!,
});
