---
name: node-testing
description: "Trigger: Node.js tests, node:test, vitest, npm test scripts, mocking, ESM test gotchas. Apply focused Node testing patterns."
license: MIT
metadata:
  author: amauta
  version: "1.0"
---

## Activation Contract

Load this skill when writing, running, or reviewing Node.js tests, configuring `npm test`, mocking modules or timers, or fixing ESM/CJS test failures.

## Hard Rules

- Use the runner the repo already has. Zero-dependency projects: `node:test` + `node:assert/strict`. Projects with a build/TS toolchain or watch mode needs: `vitest`.
- `package.json`: `"test": "node --test"` (or `"vitest run"` for CI; plain `vitest` watches). Judge results by the exit code.
- Test behavior through the public module; one theme per `test()`; use `t.beforeEach` / `afterEach` or `try/finally` for cleanup.
- Temp files: `fs.mkdtemp(path.join(os.tmpdir(), 'x-'))`; always remove in `finally`; never touch the real `$HOME` (inject `HOME`/config dirs through options or env).
- Async: `await` every promise, use `assert.rejects` for failures; never leave open handles (servers, timers) — close them in cleanup.
- Never `sleep`; use mock timers.

## Mocking

| Need | node:test | vitest |
|---|---|---|
| Spy / stub a function | `mock.fn()`, `mock.method(obj, 'm')` | `vi.fn()`, `vi.spyOn(obj, 'm')` |
| Fake timers | `mock.timers.enable({ apis: ['setTimeout'] })` then `.tick(ms)` | `vi.useFakeTimers()` |
| Mock a module | inject the dependency instead; or `mock.module()` (experimental, needs `--experimental-test-module-mocks`) | `vi.mock('./dep.js')` (hoisted) |
| Restore | `mock.restoreAll()` | `vi.restoreAllMocks()` |

## ESM gotchas

- Relative imports need the extension (`./x.js`); `__dirname` does not exist: use `fileURLToPath(new URL('.', import.meta.url))`.
- ESM namespace exports are read-only: you cannot spy on them; pass dependencies in (dependency injection) or mock at the module level.
- `"type": "module"` makes `.js` ESM; CommonJS needs `.cjs`. Use dynamic `import()` to load ESM from CJS.
- Run one file: `node --test test/a.test.js`; filter by name: `--test-name-pattern="regex"`.
- Subprocess tests (CLI): spawn `process.execPath` with an explicit `env` and a temp `cwd`.
