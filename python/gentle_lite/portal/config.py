from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    state_dir: Path
    claude_home: Path
    engram_db: Path | None = None
    repos: list = field(default_factory=list)
    graphify: Path | None = None

    def __post_init__(self):
        self.state_dir = Path(self.state_dir)
        self.claude_home = Path(self.claude_home)
        self.engram_db = Path(self.engram_db) if self.engram_db else None
        self.repos = [Path(r) for r in self.repos]
        self.graphify = Path(self.graphify) if self.graphify else None

    @property
    def db_path(self) -> Path:
        return self.state_dir / "memory.db"
