import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 70 },
      exclude: [
        // Infrastructure — connect to real services at startup; no unit tests
        'src/loaders/**',
        'src/config/**',
        'src/index.ts',
        // Prisma client init — requires a real DB connection; no unit-testable logic
        'src/models/index.ts',
        // Route files — pure Express router.use/get/post declarations; no logic
        'src/api/*.routes.ts',
        // Type declarations — no runtime code
        'src/types/**',
        // Non-source files
        'prisma/**',
        'skills/**',
        'docs/**',
        '*.config.ts',
        '*.config.mjs',
      ],
    },
  },
});
