// The Python the test runner itself found on its full PATH (CI installs 3.11+ there). Tests that narrow PATH pass it as
// AMAUTA_PYTHON, because the system python3 left on a narrow PATH can be too old (macOS ships Xcode's 3.9; plan N9b).
import { spawnSync } from 'node:child_process';

const r = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
export const PY = r.status === 0 && r.stdout.trim() ? r.stdout.trim() : 'python3';
