# Profiles

A profile says what an organization's work looks like, without putting it in any repository (ADR 0007).

| File | Holds |
| --- | --- |
| `brand.md` | palette, fonts, logo and template file names (the files themselves in the profile's `assets/`) |
| `conventions.md` | naming, code and SQL style, date and number formats, language of deliverables |
| `glossary.md` | approved terms and metric definitions (meaning, grain, population, formula, owner role, version) |
| `sources.md` | data sources by purpose and owner role; never hosts, connection strings or credentials |
| `people/roles.md` | roles only; never names, e-mail addresses or phone numbers |

Layers, first match wins per file: the project (`<repo>/.amauta/profile/<file>`), the selected organization profile
(`<state dir>/profiles/<name>/`), the shipped `default` (`assets/profiles/default/`, neutral). The selection is stored
per git root in `<state dir>/profiles/selection.json`, so an organization's name never lands in a repository.

```
amauta profile new <name>            # a private profile from the default files, in the state directory
amauta profile use <name> [--cwd D]  # select it for the project that contains D (`use default` clears it)
amauta profile show [--cwd D]        # which file comes from which layer; skills read the paths it prints
amauta profile check <name>          # privacy guard: secrets, identifiers, contacts, names in people/ (exit 1)
amauta profile list
```

A profile is never synced, linked into a skills folder or published. Run `check` after every edit, and keep the
profile on this machine.
