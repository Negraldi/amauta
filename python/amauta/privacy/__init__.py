"""The data-security pillar (plan D4, ADR 0007): the privacy hook and `amauta privacy scan|redact|pseudonymize`.

Friction, not isolation: the hook asks before a data file is read and warns about secrets in prompts; it never denies.
Built on the kernel detector catalog (`amauta.detectors`). Stdlib only, no network.
"""
