---
name: cpp-testing
description: "Trigger: C++ tests, GoogleTest, Catch2, CMake ctest, ASan/UBSan, testing a Node native addon or Python C extension. Apply focused C++ testing patterns."
license: MIT
metadata:
  author: amauta
  version: "1.0"
---

## Activation Contract

Load this skill when writing, running, or reviewing C++ tests, wiring tests into CMake, running sanitizers, or testing native code exposed to Node (node-gyp / N-API) or Python (pybind11 / C extensions).

## Hard Rules

- Use the framework the repo already uses; default to GoogleTest, Catch2 only when already present.
- Register tests with CMake: `enable_testing()`, then `gtest_discover_tests(target)` (GoogleTest) or `catch_discover_tests(target)` (Catch2). Run with `ctest --test-dir build --output-on-failure`.
- Build tests in a separate out-of-source dir (`cmake -S . -B build`); never commit `build/`.
- Test behavior through the public header; one assertion theme per `TEST`; use fixtures (`TEST_F`) for shared setup and `TEST_P` / `GENERATE` for tables.
- Use `EXPECT_*` to keep going, `ASSERT_*` only when later lines would crash.
- Write temp files under `std::filesystem::temp_directory_path()` with unique names; never touch the real home.
- No sleeps; inject clocks and I/O behind small interfaces.

## Sanitizers

| Goal | Configure |
|---|---|
| Memory errors, leaks | `-DCMAKE_CXX_FLAGS="-fsanitize=address -fno-omit-frame-pointer -g"` |
| Undefined behavior | add `-fsanitize=undefined -fno-sanitize-recover=undefined` |
| Data races | separate build with `-fsanitize=thread` (cannot combine with ASan) |

Run the whole suite under sanitizers in CI; a sanitizer report is a test failure.

## Native addons

| Target | Pattern |
|---|---|
| Core logic | Keep it a plain C++ library with its own gtest target; the binding is a thin layer. |
| Node addon (node-gyp / node-addon-api) | Build with `node-gyp rebuild`, then test the loaded `.node` from `node:test` or vitest; assert thrown `Error` types and argument validation. |
| Python (pybind11 / C ext) | Build in a venv (`pip install -e .`), then test from pytest; check refcount-sensitive paths by looping many calls, and exceptions mapped to Python types. |
| ASan with a host runtime | Preload the ASan runtime (`LD_PRELOAD=$(c++ -print-file-name=libasan.so)`) and set `ASAN_OPTIONS=detect_leaks=0` for Node/Python hosts. |

## Execution Steps

1. Detect the build (CMakeLists.txt, binding.gyp, pyproject.toml) and the existing test framework.
2. Write the failing test, build, run `ctest`, and observe RED.
3. Implement, rebuild, observe GREEN; then run the sanitizer build.
