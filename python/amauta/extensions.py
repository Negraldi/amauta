"""Extension registry (ADR 0009): how the kernel and pillars reach optional extras without importing them.

An extra is a package under `python/amauta/extras/<name>/` whose `__init__.py` defines
`POINTS = {"point.name": function}`. The registry lists that directory, imports each package dynamically (once) and
answers `call(point, ...)` with the first extra's result or `collect(point, ...)` with all of them. Deleting an extra's
folder removes its feature and nothing else. Side effects: imports extras on first use. Failure mode: a missing
directory or an extra that fails to import contributes no points.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


class Registry:
    def __init__(self, root: Path, package: str):
        self.root, self.package, self._points = Path(root), package, None

    def _load(self):
        if self._points is not None:
            return self._points
        self._points = {}
        try:
            entries = sorted(p for p in self.root.iterdir() if (p / "__init__.py").is_file())
        except OSError:
            entries = []
        for entry in entries:
            name = f"{self.package}.{entry.name}"
            try:
                module = sys.modules.get(name) or self._import(name, entry / "__init__.py")
            except Exception:  # noqa: BLE001 - a broken extra must not break the portal
                continue
            self._points[entry.name] = dict(getattr(module, "POINTS", {}))
        return self._points

    @staticmethod
    def _import(name, init):
        spec = importlib.util.spec_from_file_location(name, init, submodule_search_locations=[str(init.parent)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            del sys.modules[name]
            raise
        return module

    def names(self):
        return list(self._load())

    def collect(self, point, *args, **kwargs):
        return [fns[point](*args, **kwargs) for fns in self._load().values() if point in fns]

    def call(self, point, *args, default=None, **kwargs):
        for fns in self._load().values():
            if point in fns:
                return fns[point](*args, **kwargs)
        return default

    def has(self, point):
        return any(point in fns for fns in self._load().values())


REGISTRY = Registry(Path(__file__).resolve().parent / "extras", f"{__package__}.extras")
call, collect, has = REGISTRY.call, REGISTRY.collect, REGISTRY.has
