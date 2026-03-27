import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import swaggerUi from 'swagger-ui-express';
import type { Router } from 'express';
import { Router as createRouter } from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));

const specPath = join(__dirname, '../../docs/openapi.yaml');
const spec = parse(readFileSync(specPath, 'utf-8')) as Record<string, unknown>;

/**
 * Returns a router that serves Swagger UI at the mount point.
 *
 * Mount BEFORE helmet() in express.ts so that swagger-ui's inline scripts
 * are not blocked by the default Content-Security-Policy header.
 *
 * Usage:
 *   app.use('/api/v1/users/docs', createSwaggerRouter());
 */
export const createSwaggerRouter = (): Router => {
  const router = createRouter();

  router.use('/', swaggerUi.serve);
  router.get('/', swaggerUi.setup(spec, {
    customSiteTitle: 'Katisha User Service API',
    swaggerOptions: {
      docExpansion: 'list',
      persistAuthorization: true,
    },
  }));

  return router;
};
