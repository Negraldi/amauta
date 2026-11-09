# Intake records

Every piece of outside code or text that amauta copies, adapts or rewrites gets one record here before it lands.
Keep each record to one screen.

```
Source:        <archive or repo> · <path> · sha256 <hash of the original file>
What it does:  <one or two lines>
Interfaces:    <functions, commands, formats>
Dependencies:  <stdlib only | list>
Side effects:  <none | files, processes, network>
Origin tests:  <which tests exist and which are ported>
Decision:      copy | adapt | rewrite  ->  <destination path in amauta>
Why:           <fit with the kernel rules: stdlib, limits, no consent machinery>
Changes:       <what differs from the source>
Private data:  <none | what was removed: hosts, people, business rules, brand>
```

Copied files are also listed in `assets/manifest.json` (`vendored`) with their sha256; adapted and rewritten pieces
record the source sha256 here.
