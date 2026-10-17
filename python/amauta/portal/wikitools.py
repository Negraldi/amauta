"""Built-in tools, MCP tools and connectors for the harness wiki.

Built-in tools come from a curated catalog shipped with amauta (English and Spanish); tools seen in usage but missing from it say "Usage only".
MCP tools come from the refresh cache (`<state>/wiki/mcp-tools.json`, written by wikiprobe) and from `mcp__<server>__<tool>` names seen in usage.
A connector is a server name seen in usage that no local configuration explains (claude.ai connectors, often a UUID): only usage is known.
"""
from __future__ import annotations

import json
import re

from .wikibase import _item, _meta
from .wikiharness import BUILTIN_LABEL, USAGE_LABEL, read_json

CACHE_PARTS = ("wiki", "mcp-tools.json")
MAX_DESCRIPTION = 1000
MAX_TOOLS_PER_SERVER = 500
MAX_PARAMS = 40
SERVER_LABEL = "Reported by the server"
CONNECTOR_WHAT = ("A claude.ai connector (or a server the Claude app provides itself): it has no local configuration, so the portal cannot see its command or "
                  "settings and never contacts it. What your sessions called is all that is known.")
CONNECTOR_WHEN = "When Claude calls one of its tools during a session."
MCPTOOL_WHEN = "When Claude decides the tool fits the task, subject to your permission rules."
USAGE_ONLY_NOTE = "Seen in your sessions but not in the built-in catalog shipped with amauta."
TOOL_USAGE_NOTE = "Known only from your sessions: no description was reported. Use Refresh descriptions on the Components page for local servers."
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")


def _t(en_what, en_when, es_what, es_when):
    return {"en": {"what": en_what, "when": en_when}, "es": {"what": es_what, "when": es_when}}


BUILTIN = {
    "Read": _t("Reads a file from disk: text with line numbers, images, PDFs and notebooks.", "Whenever Claude needs to look at a file before answering or editing it.",
               "Lee un archivo del disco: texto con números de línea, imágenes, PDF y notebooks.", "Siempre que Claude necesita ver un archivo antes de responder o editarlo."),
    "Write": _t("Creates a file or replaces it entirely with new content.", "To create a new file or rewrite one completely; an existing file has to be read first.",
                "Crea un archivo o lo reemplaza por completo con contenido nuevo.", "Para crear un archivo nuevo o reescribir uno por completo; un archivo existente debe leerse antes."),
    "Edit": _t("Replaces an exact piece of text in an existing file.", "For targeted changes to a file Claude has already read.",
               "Reemplaza un fragmento exacto de texto en un archivo existente.", "Para cambios puntuales en un archivo que Claude ya leyó."),
    "MultiEdit": _t("Applies several exact-text replacements to one file in a single step.", "When one file needs many separate changes at once.",
                    "Aplica varios reemplazos de texto exacto a un mismo archivo en un solo paso.", "Cuando un archivo necesita muchos cambios separados a la vez."),
    "NotebookEdit": _t("Edits, inserts or deletes a cell of a Jupyter notebook.", "When the task changes a .ipynb file.",
                       "Edita, inserta o elimina una celda de un notebook de Jupyter.", "Cuando la tarea modifica un archivo .ipynb."),
    "Bash": _t("Runs a shell command and returns its output; the working directory persists between calls.", "To run tests, builds, git and any other command-line work, subject to your permission rules.",
               "Ejecuta un comando de shell y devuelve su salida; el directorio de trabajo se conserva entre llamadas.", "Para ejecutar pruebas, compilaciones, git y cualquier otra tarea de línea de comandos, según sus reglas de permisos."),
    "BashOutput": _t("Reads the new output of a command that runs in the background.", "After starting a long command in the background.",
                     "Lee la salida nueva de un comando que se ejecuta en segundo plano.", "Después de iniciar un comando largo en segundo plano."),
    "KillShell": _t("Stops a command that runs in the background.", "When a background command is no longer needed or is stuck.",
                    "Detiene un comando que se ejecuta en segundo plano.", "Cuando un comando en segundo plano ya no hace falta o se quedó bloqueado."),
    "Glob": _t("Finds files by name pattern, such as src/**/*.ts.", "To locate files by name before reading them.",
               "Encuentra archivos por patrón de nombre, como src/**/*.ts.", "Para ubicar archivos por nombre antes de leerlos."),
    "Grep": _t("Searches file contents with a regular expression.", "To find where a symbol, string or pattern appears in the code.",
               "Busca en el contenido de los archivos con una expresión regular.", "Para encontrar dónde aparece un símbolo, una cadena o un patrón en el código."),
    "WebFetch": _t("Fetches a web page and extracts the part that answers a question about it.", "When Claude needs the content of a specific URL.",
                   "Descarga una página web y extrae la parte que responde una pregunta sobre ella.", "Cuando Claude necesita el contenido de una URL concreta."),
    "WebSearch": _t("Searches the web and returns result titles and links.", "When the answer needs current information that is not in the project.",
                    "Busca en la web y devuelve títulos y enlaces de resultados.", "Cuando la respuesta necesita información actual que no está en el proyecto."),
    "Agent": _t("Starts a subagent with its own context to do a bounded task and report back.", "When Claude delegates research or a self-contained task, or when you ask for an agent.",
                "Inicia un subagente con su propio contexto para hacer una tarea acotada e informar el resultado.", "Cuando Claude delega una investigación o una tarea autónoma, o cuando usted pide un agente."),
    "Task": _t("The earlier name of the Agent tool: starts a subagent for a bounded task.", "Older sessions record subagent calls under this name.",
               "El nombre anterior de la herramienta Agent: inicia un subagente para una tarea acotada.", "Las sesiones antiguas registran las llamadas a subagentes con este nombre."),
    "Skill": _t("Loads a skill: a SKILL.md with instructions for a kind of task.", "When a request matches a skill's description or you type its slash command.",
                "Carga una skill: un SKILL.md con instrucciones para un tipo de tarea.", "Cuando una solicitud coincide con la descripción de una skill o usted escribe su comando de barra."),
    "TodoWrite": _t("Keeps the task list Claude shows while it works through a multi-step job.", "On work with several steps, to track what is done and what is next.",
                    "Mantiene la lista de tareas que Claude muestra mientras avanza en un trabajo de varios pasos.", "En trabajos con varios pasos, para seguir qué está hecho y qué sigue."),
    "ToolSearch": _t("Looks up deferred tools by name or keyword and loads their definitions so Claude can call them.", "When a tool Claude needs is listed by name only.",
                     "Busca herramientas diferidas por nombre o palabra clave y carga sus definiciones para que Claude pueda llamarlas.", "Cuando una herramienta que Claude necesita figura solo por su nombre."),
    "AskUserQuestion": _t("Asks you a multiple-choice question when Claude needs a decision.", "When the task depends on a choice only you can make.",
                          "Le hace una pregunta de opción múltiple cuando Claude necesita una decisión.", "Cuando la tarea depende de una elección que solo usted puede hacer."),
    "SendMessage": _t("Sends a message to another running agent, for example to continue a subagent that already has context.", "When Claude wants to follow up with an agent it started earlier.",
                      "Envía un mensaje a otro agente en ejecución, por ejemplo para continuar con un subagente que ya tiene contexto.", "Cuando Claude quiere dar seguimiento a un agente que inició antes."),
    "ScheduleWakeup": _t("Schedules Claude to wake up later and continue a loop-style task.", "When a task has to wait and resume by itself.",
                         "Programa a Claude para despertar más tarde y continuar una tarea de tipo bucle.", "Cuando una tarea debe esperar y reanudarse sola."),
    "Monitor": _t("Watches a background process and reports when it produces output or finishes.", "When Claude waits on a long-running process.",
                  "Vigila un proceso en segundo plano e informa cuando produce salida o termina.", "Cuando Claude espera un proceso de larga duración."),
    "TaskStop": _t("Stops a background task or subagent that is still running.", "When a background task is no longer needed.",
                   "Detiene una tarea en segundo plano o un subagente que sigue en ejecución.", "Cuando una tarea en segundo plano ya no hace falta."),
    "TaskOutput": _t("Reads the output of a background task or subagent.", "When Claude needs the result of work running in the background.",
                     "Lee la salida de una tarea en segundo plano o de un subagente.", "Cuando Claude necesita el resultado de un trabajo en segundo plano."),
    "EnterPlanMode": _t("Switches to plan mode: Claude explores and proposes a plan without changing files.", "At the start of a task that needs a plan you approve first.",
                        "Cambia al modo de plan: Claude explora y propone un plan sin modificar archivos.", "Al comenzar una tarea que necesita un plan que usted apruebe primero."),
    "ExitPlanMode": _t("Presents the plan for your approval and leaves plan mode.", "When the plan is ready.",
                       "Presenta el plan para su aprobación y sale del modo de plan.", "Cuando el plan está listo."),
    "EnterWorktree": _t("Moves the session into a separate git worktree.", "When work should stay isolated from the main checkout.",
                        "Mueve la sesión a un worktree de git separado.", "Cuando el trabajo debe quedar aislado de la copia principal."),
    "ExitWorktree": _t("Leaves the git worktree the session entered.", "When the isolated work is finished.",
                       "Sale del worktree de git al que entró la sesión.", "Cuando el trabajo aislado terminó."),
    "SubagentHandback": _t("Used by a subagent to deliver its final report to the agent that launched it.", "At the end of a subagent's work.",
                           "La usa un subagente para entregar su informe final al agente que lo lanzó.", "Al terminar el trabajo de un subagente."),
    "SendUserFile": _t("Sends a file from the session to you.", "When Claude has produced a file you asked for.",
                       "Le envía un archivo de la sesión.", "Cuando Claude produjo un archivo que usted pidió."),
    "Artifact": _t("Publishes an HTML page as a private artifact and manages it.", "When a page is clearer than terminal text, such as a report or dashboard.",
                   "Publica una página HTML como artefacto privado y la gestiona.", "Cuando una página es más clara que el texto de la terminal, como un informe o un panel."),
    "ListMcpResourcesTool": _t("Lists the resources that connected MCP servers expose.", "When Claude looks for data a server offers besides tools.",
                               "Lista los recursos que exponen los servidores MCP conectados.", "Cuando Claude busca datos que un servidor ofrece además de herramientas."),
    "ReadMcpResourceTool": _t("Reads one resource exposed by an MCP server.", "After listing resources, to read one.",
                              "Lee un recurso expuesto por un servidor MCP.", "Después de listar los recursos, para leer uno."),
}


def read_cache(portal) -> dict:
    """{server: {fetched_at, tools: [{name, description, params}], error?}} from the refresh cache; anything malformed is dropped, sizes are capped."""
    data = read_json(portal.cfg.state_dir.joinpath(*CACHE_PARTS))
    out = {}
    for server, entry in list(data.items())[:200]:
        if not isinstance(server, str) or not isinstance(entry, dict):
            continue
        tools = []
        for t in entry.get("tools") if isinstance(entry.get("tools"), list) else []:
            if isinstance(t, dict) and isinstance(t.get("name"), str) and t["name"]:
                params = t.get("params") if isinstance(t.get("params"), list) else []
                tools.append({"name": t["name"][:100], "description": t["description"][:MAX_DESCRIPTION] if isinstance(t.get("description"), str) else "",
                              "params": [str(p)[:60] for p in params[:MAX_PARAMS]]})
            if len(tools) >= MAX_TOOLS_PER_SERVER:
                break
        out[server[:100]] = {"fetched_at": entry.get("fetched_at") if isinstance(entry.get("fetched_at"), str) else None, "tools": tools,
                             "error": str(entry["error"])[:300] if isinstance(entry.get("error"), str) else None}
    return out


def _usage(portal):
    """({(server, tool name): stats} for MCP calls, {tool: stats} for the others)."""
    conn = portal._usage_conn()
    if conn is None:
        return {}, {}
    try:
        rows = conn.execute("SELECT c.mcp_server server, c.tool tool, count(*) n, count(DISTINCT c.session_id) sessions, min(c.ts) first_ts, max(c.ts) last_ts FROM tool_calls c "
                            "WHERE c.tool IS NOT NULL AND c.skill IS NULL GROUP BY c.mcp_server, c.tool").fetchall()
    finally:
        conn.close()
    mcp, plain = {}, {}
    for r in rows:
        stats = {"uses": r["n"], "sessions": r["sessions"], "first": r["first_ts"], "last": r["last_ts"], "name": r["tool"]}
        if r["server"]:
            prefix = f"mcp__{r['server']}__"
            mcp[(r["server"], r["tool"][len(prefix):] if r["tool"].startswith(prefix) else r["tool"])] = stats
        else:
            plain[r["tool"]] = stats
    return mcp, plain


def _usage_meta(u):
    return [("Calls", u["uses"]), ("Sessions", u["sessions"]), ("First used", u["first"]), ("Last used", u["last"])] if u else []


def _tool_entry(name, u):
    cat = BUILTIN.get(name)
    base = {"kind": "tool", "id": name, "title": name, "uses": u["uses"] if u else 0, "meta": [], "material": {"tool": name, "catalog": cat}, "usage_col": "c.tool", "usage_name": name}
    if cat:
        return {**base, "description": cat["en"]["what"], "when": cat["en"]["when"], "i18n": {"es": {"description": cat["es"]["what"], "when": cat["es"]["when"]}}, "source": BUILTIN_LABEL, "path": None}
    return {**base, "description": None, "when": None, "source": USAGE_LABEL, "path": None, "note": USAGE_ONLY_NOTE}


def collect(portal, base):
    """Built-in tool, MCP tool and connector entries (the server entries are annotated with their tool names)."""
    mcp_usage, plain = _usage(portal)
    cache = read_cache(portal)
    out = [_tool_entry(n, plain.get(n)) for n in sorted(set(BUILTIN) | set(plain)) if _SAFE.match(n)]
    servers = [e for e in base if e["kind"] == "mcp"]
    owner_of = {}
    for e in servers:
        for alias in e["aliases"]:
            owner_of.setdefault(alias, e["id"])
    names = {e["id"]: {} for e in servers}  # server -> {tool: {cache, usage}}
    connectors = {}
    for server, c in cache.items():
        if server in names:
            for t in c["tools"]:
                names[server].setdefault(t["name"], {})["cache"] = t
    for (usage_server, tool), u in mcp_usage.items():
        owner = owner_of.get(usage_server)
        if owner:
            names[owner].setdefault(tool, {})["usage"] = u
        else:
            connectors.setdefault(usage_server, {}).setdefault(tool, {})["usage"] = u
    by_id = {e["id"]: e for e in servers}
    for server, tools in names.items():
        e = by_id[server]
        e["tool_names"] = sorted(tools)
        e["uses"] = sum(t["usage"]["uses"] for t in tools.values() if "usage" in t)
        c = cache.get(server)
        if c:
            e["meta"] += _meta(("Tools refreshed", c["fetched_at"]), ("Refresh error", c["error"]))
        for tool, src in sorted(tools.items()):
            out.append(_mcptool_entry("mcp", server, tool, src, SERVER_LABEL if "cache" in src else USAGE_LABEL, c["fetched_at"] if c else None))
    for server, tools in sorted(connectors.items()):
        if not _SAFE.match(server):
            continue
        uses = sum(t["usage"]["uses"] for t in tools.values())
        calls = {"uses": uses, "sessions": max(t["usage"]["sessions"] for t in tools.values()), "first": min(t["usage"]["first"] or "" for t in tools.values()) or None,
                 "last": max(t["usage"]["last"] or "" for t in tools.values()) or None}
        out.append({"kind": "connector", "id": server, "title": server, "description": CONNECTOR_WHAT, "when": CONNECTOR_WHEN, "source": USAGE_LABEL, "path": None, "uses": uses,
                    "tool_names": sorted(tools), "meta": _meta(*_usage_meta(calls), ("Tools seen", ", ".join(sorted(tools)))), "material": {"connector": server, "tools": sorted(tools)},
                    "usage_col": "c.mcp_server", "usage_name": server})
        for tool, src in sorted(tools.items()):
            out.append(_mcptool_entry("connector", server, tool, src, USAGE_LABEL, None))
    return out


def _mcptool_entry(owner_kind, server, tool, src, source, fetched):
    cached, u = src.get("cache"), src.get("usage")
    meta = _meta(("Server", server), ("Parameters", ", ".join(cached["params"]) if cached and cached["params"] else None), *_usage_meta(u))
    entry = {"kind": "mcptool", "id": f"{server}/{tool}", "title": f"{server}/{tool}", "description": cached["description"] or None if cached else None, "when": MCPTOOL_WHEN, "source": source, "path": None,
             "uses": u["uses"] if u else 0, "owner": (owner_kind, server), "meta": meta, "material": {"server": server, "tool": tool, "cache": cached}, "tool": tool}
    if u:
        entry.update({"usage_col": "c.tool", "usage_name": u["name"]})
    if cached is None or not cached["description"]:
        entry["note"] = TOOL_USAGE_NOTE
    if cached is not None and fetched:
        entry["sections"] = [{"heading": "Reported by the server", "items": [_item(fetched, SERVER_LABEL)]}]
    return entry
