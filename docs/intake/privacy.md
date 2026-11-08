# Intake: corporate privacy pieces (plan D1)

Source archive: the corporate harness the user shared on 2026-11-07, with permission to copy (`harness_coorporativo.zip`,
`source/`). Hashes are of the original files. Nothing here carries private data: the source is a public edition with
synthetic examples; the records note it anyway.

Common decision: amauta's Python is stdlib only, so every piece that used pandas is rewritten over the `csv` module.
The catalog that the memory guard needs goes into the kernel (`python/amauta/detectors/`, module `detectors`); the
privacy hook, CLI and pseudonymization form the `data-security` pillar (`python/amauta/privacy/`).

```
Source:        harness-gateway/privacy_guard/validators.py · sha256 32f0cc64c04a085ed3be89e689644cb71b781fe24c5bf0dfa2c8cc05470ae627
What it does:  offline checksum validators: Ecuadorian cedula, natural-person RUC, email, Ecuador phones, Luhn cards
Interfaces:    is_valid_cedula, is_valid_ruc_natural, is_valid_email, is_valid_ec_phone, is_valid_card_number
Dependencies:  stdlib only
Side effects:  none
Origin tests:  test_privacy_guard.py (validator cases); ported with generated values
Decision:      adapt  ->  python/amauta/detectors/validators.py
Why:           pure functions, stdlib, small; the kernel catalog of ADR 0007
Changes:       adds juridical (third digit 9) and public-sector (6) RUC check digits and IBAN (ISO 13616 mod 97),
               which the source left out
Private data:  none
```

```
Source:        harness-gateway/privacy_guard/redact.py · sha256 edfce7b350cfad53cf524baf1113c493e49ff15b65ea30661cfe57a693a35d0c
What it does:  replaces emails and checksum-valid identifiers in free text with placeholders; returns counts only
Interfaces:    redact_text(text) -> (text, counts)
Dependencies:  stdlib only
Side effects:  none
Origin tests:  test_privacy_guard.py (redaction cases, no partial matches inside longer numbers); ported
Decision:      adapt  ->  python/amauta/detectors/scan.py
Why:           the same scan feeds the memory guard, the privacy hook and the CLI; one finding format
Changes:       also finds secrets (patterns below) and IBANs; returns findings (kind, start, end) without values
Private data:  none
```

```
Source:        harness-memory/harness_memory/privacy.py · sha256 b09196b6c6179a5eb74e9736be5f9d6834e18f5dd2a3216d9b3b2d617231e94c
What it does:  rejects secret-like text (API keys, bearer tokens, private keys, AWS keys) without echoing it
Interfaces:    contains_secret, guard_text_fields, PrivacyError, size checks
Dependencies:  stdlib only
Side effects:  none
Origin tests:  test_privacy.py; ported
Decision:      adapt  ->  python/amauta/detectors/secrets.py (patterns) and the memory guard in python/amauta/memory/
Why:           the memory guard is always on (ADR 0007, D3); the "never echo" contract is kept
Changes:       secrets are rejected and personal data is redacted before a memory is stored; the size caps already
               exist in amauta's store and are not copied
Private data:  none
```

```
Source:        harness-gateway/privacy_guard/detect.py · sha256 96c965a26e4a84d2ff09c389000225397e76b225de3ca5172dd62449d9338fa4
What it does:  flags identifier columns of a table by column-name tokens (Spanish and English) and value validators
Interfaces:    detect_identifier_columns(df), match_name_categories(name)
Dependencies:  pandas
Side effects:  none
Origin tests:  test_privacy_guard.py (column cases); ported over CSV rows
Decision:      rewrite  ->  python/amauta/privacy/columns.py
Why:           pandas is not allowed; a CSV header plus a bounded sample of rows gives the same two signals
Changes:       reads at most a fixed number of rows; findings never carry values
Private data:  none
```

```
Source:        harness-gateway/privacy_guard/pseudonymize.py, keys.py, anonymize.py
               · sha256 f7d792d776dd243405ada88641af11fee9d246bfcd1c5f66e0a91619d07ce829 (pseudonymize.py)
               · sha256 987c87805ce831b8568db8ea19619bc5afd1f9f9b31109ce9df97a59b3a088c2 (keys.py)
               · sha256 cbec0a90046ba9856a930ccfd02270acf86e04c8f760e20b7d51e5f03901def3 (anonymize.py)
What it does:  keyed HMAC-SHA256 pseudonyms per column (<TAG>_<12 hex>), a local 32-byte key, CSV end to end
Interfaces:    pseudonymize(df, columns, key), load_or_create_key(path), anonymize_csv(src, dst, key_path)
Dependencies:  pandas (pseudonymize, anonymize); stdlib (keys)
Side effects:  writes the key file and the output CSV
Origin tests:  test_privacy_guard.py (determinism, nulls, key never printed); ported
Decision:      rewrite  ->  python/amauta/privacy/pseudonymize.py
Why:           stdlib csv; the key lives under the amauta state directory (0600), never %LOCALAPPDATA%
Changes:       one module; the documented limits stay in its docstring (48-bit suffix may collide, pseudonymization is
               not anonymity)
Private data:  none
```

Not taken: `harness-gateway/egress_guard/` (the egress guard as code is out of scope, plan Scope "Out").
