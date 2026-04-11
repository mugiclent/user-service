import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import swaggerUi from 'swagger-ui-express';
import type { Router } from 'express';
import { Router as createRouter } from 'express';
import { config } from '../config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const specPath = join(__dirname, '../../docs/openapi.yaml');

const readSpec = (): Record<string, unknown> =>
  parse(readFileSync(specPath, 'utf-8')) as Record<string, unknown>;

// In production the yaml never changes at runtime — read once and cache.
// In development read fresh on every request so edits are visible on refresh.
const cachedSpec = config.isProd ? readSpec() : null;
const loadSpec = (): Record<string, unknown> => cachedSpec ?? readSpec();

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

  const swaggerOptions = {
    customSiteTitle: 'Katisha User Service API',
    swaggerOptions: {
      docExpansion: 'list',
      persistAuthorization: true,
      defaultModelExpandDepth: 2,
      defaultModelsExpandDepth: -1,
    },
    customCss: `
      /* ── Inline code in descriptions only (not example/model blocks) ── */
      .swagger-ui .info code,
      .swagger-ui .markdown code,
      .swagger-ui .renderedMarkdown code {
        padding: 2px 5px;
        margin: 0 2px;
        border-radius: 3px;
        background: #efefef;
        color: #333;
        font-size: 0.88em;
        line-height: 1.6;
        word-break: break-word;
        white-space: pre-wrap;
        display: inline-block;
        vertical-align: middle;
      }

      /* ── Keep example value blocks untouched ────────────────────────── */
      .swagger-ui .highlight-code code,
      .swagger-ui .microlight,
      .swagger-ui pre code,
      .swagger-ui .model-example code,
      .swagger-ui .example__section code,
      .swagger-ui .response-col_description code {
        all: revert;
      }

      /* ── Info / description block ────────────────────────────────────── */
      .swagger-ui .info { margin-bottom: 2.5rem; }
      .swagger-ui .info .description { line-height: 1.8; }
      .swagger-ui .info .description p { margin: 0.5rem 0; }
      .swagger-ui .info table {
        display: block;
        width: 100%;
        overflow-x: auto;
        border-collapse: collapse;
        margin: 0.75rem 0;
      }
      .swagger-ui .info table th,
      .swagger-ui .info table td {
        padding: 6px 14px;
        border: 1px solid #dde;
        line-height: 1.6;
        white-space: normal;
        word-break: break-word;
      }

      /* ── Operation descriptions ──────────────────────────────────────── */
      .swagger-ui .opblock-description-wrapper p,
      .swagger-ui .opblock-external-docs-wrapper p,
      .swagger-ui .markdown p,
      .swagger-ui .renderedMarkdown p {
        margin: 0.4rem 0;
        line-height: 1.7;
      }
      .swagger-ui .markdown table,
      .swagger-ui .renderedMarkdown table {
        border-collapse: collapse;
        width: 100%;
        margin: 0.6rem 0;
        display: block;
        overflow-x: auto;
      }
      .swagger-ui .markdown table th,
      .swagger-ui .markdown table td,
      .swagger-ui .renderedMarkdown table th,
      .swagger-ui .renderedMarkdown table td {
        padding: 5px 12px;
        border: 1px solid #dde;
        line-height: 1.6;
        word-break: break-word;
      }

      /* ── Tag section spacing ─────────────────────────────────────────── */
      .swagger-ui .opblock-tag { margin-top: 0.75rem; }
      .swagger-ui .opblock-tag-section { margin-bottom: 0.5rem; }
    `,
  };

  router.use('/', swaggerUi.serve);
  router.get('/', (req, res, next) => {
    swaggerUi.setup(loadSpec(), swaggerOptions)(req, res, next);
  });

  return router;
};
