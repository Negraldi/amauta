"""The detector catalog (plan D2, ADR 0007): offline validators, secret patterns and one text scan.

Used by the memory guard (always on), the privacy hook and CLI, and code checks. A finding is {kind, start, end} and
never carries the matched text. Kernel module: stdlib only, no network, no LLM. Source: docs/intake/privacy.md.
"""
