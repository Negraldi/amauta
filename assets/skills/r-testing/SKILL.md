---
name: r-testing
description: "Trigger: R tests, testthat 3e, renv, R package layout, snapshot tests, R CMD check, devtools::test. Apply focused R testing patterns."
license: MIT
metadata:
  author: amauta
  version: "1.0"
---

## Activation Contract

Load this skill when writing, running, or reviewing R tests, setting up testthat in a package or analysis project, pinning dependencies with renv, or running `R CMD check`.

## Hard Rules

- Use testthat edition 3: `Config/testthat/edition: 3` in `DESCRIPTION`; set up with `usethis::use_testthat(3)`.
- Layout: `R/foo.R` is tested by `tests/testthat/test-foo.R`; `tests/testthat.R` only calls `test_check("pkg")`. Shared helpers live in `tests/testthat/helper-*.R`, fixtures in `tests/testthat/fixtures/` (read with `testthat::test_path()`).
- Test behavior with `test_that("does X when Y", { ... })`; one theme per block; prefer `expect_equal(tolerance =)` for numerics and `expect_error(..., class =)` / `expect_warning` for conditions.
- Files: `withr::local_tempfile()` / `withr::local_tempdir()`; reset options and env with `withr::local_options()` / `local_envvar()`; never write to the project tree or the real home.
- Set seeds explicitly (`withr::local_seed(1)`); no tests that depend on the current date or network (use `skip_on_cran()`, `skip_if_offline()`, `skip_if_not_installed()`).
- Reproducible deps: `renv::init()`, `renv::snapshot()`, `renv::restore()`; commit `renv.lock`, not the library.

## Patterns

| Need | Use |
|---|---|
| Big or structured output | `expect_snapshot()` / `expect_snapshot_value()` / `expect_snapshot_file()`; review with `testthat::snapshot_review()`, accept with `snapshot_accept()` |
| Data frames | `expect_equal(df, expected)` on small constructed `tibble()`/`data.frame()`; compare with `ignore_attr` only when justified |
| Mock a dependency | `local_mocked_bindings(fn = function(...) ...)` (3e) |
| Many cases | loop over a list inside one `test_that`, or `patrick::with_parameters_test_that` if already a dependency |

## Commands

- Single file: `testthat::test_file("tests/testthat/test-foo.R")`; package: `devtools::test()`; filter: `devtools::test(filter = "foo")`.
- Non-interactive: `Rscript -e 'devtools::test()'`; full gate: `R CMD build . && R CMD check --no-manual pkg_*.tar.gz` (a non-zero exit, ERROR or WARNING means failure).
- Analysis project without a package: `testthat::test_dir("tests/testthat")` under `renv`.
