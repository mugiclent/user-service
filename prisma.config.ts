import { defineConfig } from 'prisma/config';
import 'dotenv/config';

// Prisma 7: connection config lives here, not in schema.prisma.
// datasource.url is used by CLI commands (migrate dev, migrate deploy, etc.).
// All CLI migration commands use DIRECT_DATABASE_URL (db:5432) to bypass
// PgBouncer — migrations need a real session connection for advisory locks and DDL.
// The app runtime uses DATABASE_URL (PgBouncer) via src/models/index.ts.
export default defineConfig({
  schema: './prisma/schema.prisma',
datasource: {
    url: process.env['DIRECT_DATABASE_URL']!,
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
