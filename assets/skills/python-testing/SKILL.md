---
name: python-testing
description: "Trigger: Python tests, pytest, unittest, fixtures, parametrize, tmp_path, venv, data-driven tests. Apply focused Python testing patterns."
license: MIT
metadata:
  author: amauta
  version: "1.0"
---

## Activation Contract

Load this skill when writing, running, or reviewing Python tests (pytest or unittest), adding fixtures, or testing code that reads data files.

## Hard Rules

- Follow the runner the repo uses: `pytest` if configured (`pyproject.toml`, `pytest.ini`), otherwise `python3 -m unittest discover`.
- Isolate the environment: use a venv (`python3 -m venv .venv && .venv/bin/pip install -e .[test]`); never `pip install` into the system interpreter.
- Test behavior, not implementation; one reason to fail per test; name tests after the behavior.
- Files: pytest `tmp_path` / `tmp_path_factory`, unittest `tempfile.TemporaryDirectory`. Never write to the repo tree or the real `$HOME`; patch the env with `monkeypatch.setenv("HOME", str(tmp_path))`.
- Share setup with fixtures (`conftest.py`), keep scope narrow (default `function`); use `yield` fixtures for teardown.
- Replace boundaries (network, clock, subprocess) with `monkeypatch` or `unittest.mock.patch`; never mock the unit under test.
- No sleeps, no order dependence, no randomness without a fixed seed.

## Patterns

| Need | Use |
|---|---|
| Many inputs, one rule | `@pytest.mark.parametrize("a,b,expected", [...], ids=[...])`; unittest: `self.subTest(...)` |
| Expected error | `with pytest.raises(ValueError, match="...")`; unittest `assertRaisesRegex` |
| Floats | `pytest.approx(x)` |
| Data-driven from files | Keep tiny fixtures under `tests/data/`, load with `Path(__file__).parent`; build large or messy inputs in `tmp_path` instead of committing them |
| Slow or external | `@pytest.mark.slow` / `skipUnless`, deselect with `-m "not slow"` |
| Output capture | `capsys`, `caplog` |

## Execution Steps

1. Write the failing test and run it (`pytest -x -q path::test`) to observe RED.
2. Implement; run the file, then the whole suite; observe GREEN.
3. Judge by exit code, not by the output text.
