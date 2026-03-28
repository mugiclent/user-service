# LINT.md — Linting & Type-checking Conventions

All code must pass `npx tsc --noEmit` and `npx eslint src/ tests/` with zero
errors before a PR can merge. The CI pipeline enforces both as hard gates.

---

## Commands

```bash
npx tsc --noEmit          # type-check src/ only (tsconfig.json)
npx eslint src/ tests/    # lint src/ and tests/
npx eslint src/ tests/ --fix  # auto-fix safe issues (import order, etc.)
```

---

## TypeScript config files

Two tsconfig files exist side by side:

| File | Used by | Covers |
|---|---|---|
| `tsconfig.json` | `tsc --build`, IDE, Vitest | `src/**` only |
| `tsconfig.eslint.json` | ESLint (tests block) | `src/**` + `tests/**` |

`tsconfig.json` has `"exclude": ["tests"]` and `"rootDir": "src"` — the
compiler never emits test files. `tsconfig.eslint.json` extends it and
overrides both `exclude` (drops `tests`) and `rootDir` (sets to `.`) so
ESLint can type-check test files against the same TypeScript settings.

**Do not** remove the `exclude` override from `tsconfig.eslint.json` — without
it the parent's `"exclude": ["tests"]` is inherited and all test files become
invisible to the ESLint parser (the exact bug we fixed in commit `f574cfa`).

---

## ESLint config — `eslint.config.mjs`

Two config blocks, same rules, different tsconfig:

```js
// src/**/*.ts  → project: "./tsconfig.json"
// tests/**/*.ts → project: "./tsconfig.eslint.json"
```

### Rules in force

| Rule | Setting | What it enforces |
|---|---|---|
| `@typescript-eslint/no-unused-vars` | error | All declared vars must be used. Args starting with `_` are exempt |
| `@typescript-eslint/no-explicit-any` | error | No bare `any`. Use `unknown`, a specific type, or a targeted disable comment with an explanation |
| `@typescript-eslint/consistent-type-imports` | error (`prefer: "type-imports"`) | Types imported only as values must use `import type` |
| `@typescript-eslint/no-require-imports` | error (from recommended) | No `require()` — use `import` |
| `no-console` | warn (`allow: ["warn", "error"]`) | Only `console.warn` and `console.error` are allowed |

---

## Common errors and how to fix them

### `'X' is defined but never used`
```ts
// Bad
const ability = buildAbilityFromRules(user.rules);  // never used below

// Good — either use it or remove it
// If a function parameter must exist but is intentionally unused, prefix with _
async function handler(_req: Request, res: Response) { ... }
```

### `Imports "X" are only used as a type`
```ts
// Bad
import { Prisma } from '../models/index.js';
// used only as: Prisma.UserUncheckedUpdateInput

// Good
import type { Prisma } from '../models/index.js';
```

### `` `import()` type annotations are forbidden ``
```ts
// Bad — inline import() in a type position
const actual = await importOriginal<typeof import('../../src/utils/crypto.js')>();

// Good — declare at top of file, reference by name
import type * as CryptoModule from '../../src/utils/crypto.js';
// ...
const actual = await importOriginal<typeof CryptoModule>();
```

### `A require() style import is forbidden`
```ts
// Bad — inside a test body
const { packRules } = require('@casl/ability/extra');

// Good — top-level import
import { packRules } from '@casl/ability/extra';
```

### `Unexpected console statement`
```ts
// Bad
console.log('[server] started');

// Good
console.warn('[server] started');
console.error('[server] failed to start', err);
```

### `Unexpected any. Specify a different type`
```ts
// Bad
const result = someFunc() as any;

// Good option 1 — use unknown and narrow
const result = someFunc() as unknown;
if (typeof result === 'string') { ... }

// Good option 2 — use the correct type
const result = someFunc() as SpecificType;

// Good option 3 — when a third-party type is genuinely incompatible
// (e.g. jsonwebtoken StringValue branded type), add a targeted disable:
// eslint-disable-next-line @typescript-eslint/no-explicit-any
expiresIn: config.jwt.expiresIn as any, // jsonwebtoken v9 StringValue branded type
```

---

## Writing new code — checklist

Before committing any new file or change:

- [ ] Run `npx tsc --noEmit` — zero errors
- [ ] Run `npx eslint src/ tests/` — zero errors, warnings only for `console`
      (and only if `console.warn`/`console.error` are used)
- [ ] Every imported symbol is used, or prefixed with `_`
- [ ] All type-only imports use `import type`
- [ ] No `require()` anywhere
- [ ] No `console.log` — use `console.warn` or `console.error`
- [ ] No bare `as any` without a disable comment and explanation

---

## Adding a new src file

1. Write the file under `src/`
2. It is automatically included by `tsconfig.json` and the `src` ESLint block
3. No config changes needed

## Adding a new test file

1. Write the file under `tests/unit/` or `tests/integration/`
2. It is automatically included by `tsconfig.eslint.json` and the `tests`
   ESLint block
3. No config changes needed
4. See `skills/TEST.md` for mock ordering rules

---

## Pipeline gate — `.github/workflows/ci-cd.yml`

```yaml
- run: npx tsc --noEmit       # type-check
- run: npx eslint src/ tests/ # lint
- run: npx vitest run         # tests
```

All three steps run in the `checks` job on every push and every PR. The
`build-and-push` and `deploy` jobs only start after `checks` passes — a lint
failure blocks deployment entirely.

The pipeline runs `npx prisma generate` before the checks so that Prisma
client types are available to the TypeScript compiler and the linter.

---

## Do not

- Do not add `"tests"` back to `exclude` in `tsconfig.eslint.json` — it
  breaks ESLint parsing of all test files
- Do not use `eslint-disable-file` or `/* eslint-disable */` at the file
  level — use line-level disables with a comment explaining why
- Do not add rules that conflict with TypeScript's own type narrowing (e.g.
  `no-extra-boolean-cast` fighting with strict null checks)
- Do not bypass the pipeline with `--no-verify` on commits
