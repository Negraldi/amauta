// A config.toml in the shape Codex itself writes: quoted server names, dotted .env and .tools.<tool> sub-tables.
export const CODEX_SHAPE = `# user config
model = "gpt-5"

[hooks.state]
"/x/hooks.json:stop:0:0" = { trusted_hash = "sha256:ab" }

[mcp_servers.node_repl]
command = "/usr/lib/chatgpt/node"
args = ["repl.js"]

[mcp_servers.node_repl.env]
NODE_REPL_MODE = "1"

[mcp_servers."amauta-memory"]
command = "python3"
args = ["-P", "-m", "amauta.memory", "serve"]

[mcp_servers."amauta-memory".env]
PYTHONPATH = "/home/u/amauta-dev/python"
AMAUTA_STATE_DIR = "/home/u/.amauta"
AMAUTA_RUNTIME = "codex"

[mcp_servers."amauta-memory".tools.mem_search]
approval_mode = "approve"

[mcp_servers."amauta-memory".tools.mem_save]
approval_mode = "approve"

[mcp_servers."amauta"]
command = "/home/u/.nvm/node"
args = ["/home/u/amauta-dev/src/mcp/server.js"]

[mcp_servers."amauta".env]
AMAUTA_STATE_DIR = "/home/u/.amauta"
AMAUTA_RUNTIME = "codex"
AMAUTA_CODEX_SKILLS_DIR = "/home/u/.agents/skills"

[mcp_servers."amauta".tools.skill_registry_refresh]
approval_mode = "approve"

[projects."/home/u/proj"]
trust_level = "trusted"
`;
