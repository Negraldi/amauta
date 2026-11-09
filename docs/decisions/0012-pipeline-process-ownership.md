# 0012 Pipelines: a step owns its processes, a lock knows its process

Status: accepted 2026-11-08 (after the third independent review). Refines 0011; replaces its note that on Windows a
step's child could still hold its output open.

## Context

ADR 0011 stopped a step's process group on POSIX and left a known gap on Windows. Two later reviews found more ways a
run could outlive its control: a runner killed outright stayed a zombie and kept its lock; a process id reused by
another program kept a dead runner's lock; a child that left its group on purpose held a step's output; run names
repeated on Windows clocks; `--events` outside the runs folder skipped the lock.

## Decision

- A step owns its processes: a POSIX process group or a Windows job object with kill-on-close (`winjob.py`), one
  object (`proc._Tree`) to stop them on timeout, cancel and at the step's end. Output is read in a thread; a process
  that left the tree and still holds the output is given up on after two seconds, with a line saying so.
- A lock records its process id and its start time (`pidinfo.py`: `/proc`, `ps` in C locale and UTC, or Windows
  creation time). A process that is gone, a zombie, or a live process started at another time no longer holds it;
  start times are compared only when read the same way. Replacing a stale lock and adopting one happen under an OS
  file lock on `<lock>.guard`.
- Run files are reserved with O_EXCL; a run's events file must sit in its pipeline's runs folder, beside its lock.

## Rejected

Starting steps suspended to close the moment before a Windows process joins its job (Popen cannot resume a suspended
process without more native code); killing a process that left the tree on purpose (it is no longer the step's).

## Consequences

The Windows behavior is tested on the Windows CI job (`test/portable.json`). If the runner itself is killed outright,
the step running at that moment keeps running (its group or job is not the runner's); the run reads as abandoned.
