# 0004 Simplicity limits enforced as a ratchet

Status: accepted 2026-11-07.

## Context

On `b0762c9`: 8 files over 400 lines, 14 functions over 60 lines, 1,000 lines over 140 characters in 74 of 106
files. Reformatting everything would be a large diff with no behavior value and no formatter (no dependencies).

## Decision

Limits: file <= 400 lines, function <= 60 lines, line <= 140 characters, zero runtime dependencies, README <= 200
lines. A test records the current violations as a baseline and fails when a file gets worse or a new file breaks a
limit. New or changed source files need a header comment (purpose, inputs and outputs, side effects, failure mode).
Vendored files are exempt and listed.

## Rejected

Reformat everything now; a written guide without a test; stricter limits (250/40).

## Consequences

Old code is cleaned when it is touched; the baseline can only shrink.
