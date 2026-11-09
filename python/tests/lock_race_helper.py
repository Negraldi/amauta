"""A child process for the lock race test: wait for the start signal, try to take the lock, report 1 or 0."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from amauta.extras.pipelines import lock  # noqa: E402

f, go, me = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
while not go.exists():
    time.sleep(0.001)
print(1 if lock.take(f, f"run-{me}") else 0, flush=True)
time.sleep(1)  # hold on: a winner that exits at once would look dead to the others
