from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    state_dir: Path
    claude_home: Path
    engram_db: Path | None = None
    codex_home: Path | None = None  # Codex usage is imported by Refresh usage only when this is set
    repos: list = field(default_factory=list)
    home: Path | None = None  # what counts as $HOME for project discovery; the real home when None (tests set it)

    def __post_init__(self):
        self.state_dir = Path(self.state_dir)
        self.claude_home = Path(self.claude_home)
        self.engram_db = Path(self.engram_db) if self.engram_db else None
        self.codex_home = Path(self.codex_home) if self.codex_home else None
        self.repos = [Path(r) for r in self.repos]
        self.home = Path(self.home) if self.home else None

    @property
    def db_path(self) -> Path:
        return self.state_dir / "memory.db"
