# 0007 Data security, detectors, privacy hook, private profiles

Status: accepted 2026-11-07.

## Context

The user works with regulated, sensitive data. The corporate harness isolates analysis in a Windows sandbox;
amauta has no isolation and should not pretend to. A private agent archive holds organization knowledge (brand,
business rules, source pointers, conventions) that must never reach this public repository.

## Decision

- One detector catalog (secrets, cedula and RUC with check digits, Luhn cards, email, +593 phones, IBAN) used by the
  memory guard, the privacy hook, the privacy CLI and code checks. Fixtures are generated, never real.
- Memory guard always on. Privacy hook on by default, acting on data files outside test, fixture and example paths and
  on configured paths; it always asks and never denies; secrets in prompts only warn. Documented as friction, not
  isolation.
- Profiles: a neutral `default` profile ships with amauta; a private organization profile lives under
  `<state dir>/profiles/<name>/`, extends `default`, is selected per project (project > org > default), keeps roles
  only (no names or emails) in `people/`, is scanned by the privacy guard and never synced or published.
  `amauta profile harvest` and `amauta profile import` produce a draft the user reviews before anything is saved.

## Rejected

Copying the private archive into skills; storing credentials or SQL logins in profiles; denying reads outright.

## Consequences

Skills stay generic and public; organization specifics stay on the user's machine.
