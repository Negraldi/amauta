"""Curated descriptions of the hook commands amauta ships, for the harness wiki (portal `#/hook/...`).

Input: a (masked) hook command line. Output: `(short name, description)` or None. The per-event dispatcher
(`amauta.js hook event <Event> ... --with a,b`) is described by its handlers in order. No side effects.
"""
from __future__ import annotations

import re

TELEMETRY = ("Records one hook event (event name, tool, project, size) in the local amauta telemetry database. "
             "It reads the event on stdin, sends nothing over the network and never blocks Claude.")
USAGE = "Imports the finished session's token, tool and skill usage from the Claude Code transcript into the local amauta usage database."
REVIEW = "When review mode is on, reminds Claude once per candidate commit to run the amauta review before stopping."
REGISTRY = ("Refreshes the project's skill registry (.atl/skill-registry.md) when you submit a prompt, "
            "so delegated work sees current skills.")
GRAPHIFY = ("Connects a git repository that has a graphify graph but no amauta git hooks (installs them and starts one "
            "background refresh), so its graph reaches the portal. Skips repositories that ran `amauta graphify hook uninstall`.")

# Commands an earlier install wrote: (substring of the command, short name, what it does).
HOOK_SUMMARIES = (
    ("amauta.telemetry hook", "amauta telemetry", TELEMETRY),
    ("amauta.usage hook", "amauta usage", USAGE),
    ("hook review-stop", "amauta review reminder", REVIEW),
    ("hook skill-registry", "amauta skill registry", REGISTRY),
    ("hook graphify-connect", "amauta graphify connect", GRAPHIFY),
    ("amauta.memory", "amauta memory", "Runs the amauta memory component."),
)
HANDLER_SUMMARIES = {
    "telemetry": TELEMETRY,
    "usage": USAGE,
    "review-stop": REVIEW,
    "skill-registry": REGISTRY,
    "graphify-connect": GRAPHIFY,
    "sync-check": ("Re-syncs MCP servers, skills and instruction blocks between Claude Code and Codex when either side "
                   "changed (a hash compare when nothing moved)."),
    "sdd-preflight": ("Lets an sdd-* subagent start only after the SDD preflight question was asked and answered; "
                      "denies it when the check cannot run."),
}
# Spanish texts for the dispatcher description, which the server composes from several handlers (sent as `i18n.es`).
HANDLER_SUMMARIES_ES = {
    "telemetry": ("Registra un evento de hook (nombre del evento, herramienta, proyecto, tamaño) en la base de datos local de telemetría "
                  "de amauta. Lee el evento por la entrada estándar, no envía nada por la red y nunca bloquea a Claude."),
    "usage": ("Importa el uso de tokens, herramientas y skills de la sesión terminada, desde la transcripción de Claude Code, "
              "a la base de datos local de uso de amauta."),
    "review-stop": ("Cuando el modo de revisión está activo, recuerda a Claude una vez por cada candidato de commit que ejecute la "
                    "revisión de amauta antes de detenerse."),
    "skill-registry": ("Actualiza el registro de skills del proyecto (.atl/skill-registry.md) cuando usted envía un mensaje, para que "
                       "el trabajo delegado vea las skills vigentes."),
    "graphify-connect": ("Conecta un repositorio git que tiene un grafo de graphify pero no los hooks de git de amauta (los instala e "
                         "inicia una actualización en segundo plano), para que su grafo llegue al portal. Omite los repositorios donde "
                         "se ejecutó `amauta graphify hook uninstall`."),
    "sync-check": ("Vuelve a sincronizar los servidores MCP, las skills y los bloques de instrucciones entre Claude Code y Codex "
                   "cuando cambió alguno de los dos lados (si nada cambió, solo compara un hash)."),
    "sdd-preflight": ("Deja iniciar un subagente sdd-* solo después de que se hizo y se respondió la pregunta previa de SDD; lo "
                      "rechaza cuando la comprobación no puede ejecutarse."),
}
DISPATCH = re.compile(r"amauta\.js['\"]?\s+hook\s+event\s+\S+.*?--with\s+([\w,-]+)")


def known_hook(command):
    """(short name, description, Spanish description or None) for a command amauta ships, or None."""
    m = DISPATCH.search(command)
    if m:
        names = [n for n in m.group(1).split(",") if n in HANDLER_SUMMARIES]
        what = " ".join(HANDLER_SUMMARIES[n] for n in names)
        return f"amauta hooks: {', '.join(names)}", what, " ".join(HANDLER_SUMMARIES_ES[n] for n in names)
    return next(((short, what, None) for needle, short, what in HOOK_SUMMARIES if needle in command), None)


def hook_handlers(cmd: str) -> list:
    """Handler names of amauta's per-event dispatcher command (amauta's own names only), else []."""
    m = DISPATCH.search(cmd)
    return [n for n in m.group(1).split(",") if n] if m else []


def hook_kind(cmd: str) -> str:
    """A short kind for the Harness hooks table; never the command text of other tools."""
    if DISPATCH.search(cmd):
        return "amauta"
    if re.search(r"amauta\.(telemetry|usage)", cmd):
        return re.search(r"amauta\.(telemetry|usage)", cmd).group(1)  # commands an earlier install wrote
    m = re.search(r"amauta\.js\S*\s+hook\s+(skill-registry|review-stop|graphify-connect)", cmd)
    return m.group(1) if m else "other"
