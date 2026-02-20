import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDisallowedTools } from "./agent-tools.js";

export interface CoordinatorConfig {
	eventSocketPath: string;
	mcpServerPath: string;
}

function writeScript(dir: string, filename: string, content: string): string {
	const filePath = join(dir, filename);
	writeFileSync(filePath, content);
	return filePath;
}

export function writeImageViewerMcp(
	dir: string,
	allowedPaths: string[],
): string {
	const allowedJson = JSON.stringify(allowedPaths);
	const script = `#!/usr/bin/env node
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const ALLOWED = new Set(${allowedJson});

const rl = readline.createInterface({ input: process.stdin, terminal: false });
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }

rl.on("line", (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const id = req.id;
  switch (req.method) {
    case "initialize":
      send({ jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "image-viewer", version: "1.0.0" },
      }});
      break;
    case "notifications/initialized":
      break;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: [{
        name: "view_image",
        description: "View an attached image file. Returns the image for visual analysis.",
        inputSchema: {
          type: "object",
          properties: { file_path: { type: "string", description: "Absolute path to the image file" } },
          required: ["file_path"],
        },
      }]}});
      break;
    case "tools/call": {
      const filePath = req.params?.arguments?.file_path;
      if (!filePath || !ALLOWED.has(path.resolve(filePath))) {
        send({ jsonrpc: "2.0", id, result: {
          content: [{ type: "text", text: "Access denied: only attached images can be viewed." }],
          isError: true,
        }});
        break;
      }
      try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
        send({ jsonrpc: "2.0", id, result: {
          content: [{ type: "image", data: data.toString("base64"), mimeType: mime }],
        }});
      } catch (err) {
        send({ jsonrpc: "2.0", id, result: {
          content: [{ type: "text", text: "Error: " + err.message }],
          isError: true,
        }});
      }
      break;
    }
    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
      }
  }
});
`;
	return writeScript(dir, "image-viewer-mcp.js", script);
}

export function writeCoordinatorMcp(
	dir: string,
	config: CoordinatorConfig,
	graphPath: string,
	cliModel: string,
): string {
	const script = `#!/usr/bin/env node
const { spawn } = require("child_process");
const readline = require("readline");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const MCP_SERVER_PATH = ${JSON.stringify(config.mcpServerPath)};
const EVENT_SOCKET_PATH = ${JSON.stringify(config.eventSocketPath)};
const GRAPH_PATH = ${JSON.stringify(graphPath)};

const SEARCH_SYSTEM_PROMPT = \`You are a memory search agent. Your job is to navigate a knowledge tree to find information relevant to the user's message.

You navigate one step at a time using walk_graph:
1. Call walk_graph(action: "start") to see the root and its top-level categories.
2. Look at the children and pick the 1-2 MOST relevant categories for the query.
3. Go DEEP into the most promising branch first — explore its children and grandchildren before backtracking.
4. If a branch isn't useful, backtrack with walk_graph(action: "up", nodeId: "current-node-id").
5. When you've found enough relevant information, call walk_graph(action: "done").

STRATEGY — depth-first, not breadth-first:
- After seeing the top-level categories, pick the BEST one and go deep. Do NOT scan across all categories first.
- Commit to a branch: keep going down until you find the relevant details or hit a dead end.
- Only explore a second branch if the first one didn't have what you need.
- NEVER re-visit a branch you already explored.

RULES:
- Only use walk_graph. You have 3 actions: "down", "up", "done".
- Always start with walk_graph(action: "start").
- For "down": nodeId must be one of the children shown in the current view.
- For "up": nodeId should be your current position's id.
- Explore at most 2-3 top-level branches total.
- IMPORTANT: Always navigate DOWN into the node that contains the answer. If you see a relevant child in the children list, you MUST call walk_graph(action: "down") to visit that child node before calling "done". Never stop at a parent just because you can see the answer in its children list.
- Do NOT respond to the user. Only navigate and summarize.

After navigating, output EXACTLY:
<memory_context>
[Summary of relevant facts found, organized by topic. Include node IDs.]
</memory_context>\`;

const BLOCKED = ${JSON.stringify(getDisallowedTools("search"))};

const rl = readline.createInterface({ input: process.stdin, terminal: false });
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }

function sendToSocket(event, data) {
  try {
    const conn = net.createConnection(EVENT_SOCKET_PATH);
    conn.write(JSON.stringify({ event, data }) + "\\n");
    conn.end();
  } catch {}
}

function runSearchAgent(query) {
  return new Promise((resolve) => {
    const invDir = path.join(os.tmpdir(), "willow-cli", crypto.randomUUID().slice(0, 12));
    fs.mkdirSync(invDir, { recursive: true });

    const mcpConfigPath = path.join(invDir, "mcp-config.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify({
      mcpServers: {
        willow: { type: "stdio", command: "node", args: [MCP_SERVER_PATH], env: { WILLOW_GRAPH_PATH: GRAPH_PATH } }
      }
    }));

    const systemPromptPath = path.join(invDir, "system-prompt.txt");
    const suffix = "\\nIMPORTANT CONSTRAINTS:\\n- Only use MCP tools prefixed with mcp__willow__ to manage the knowledge graph.\\n- Never attempt to use filesystem, code editing, web browsing, or any non-MCP tools.\\n- When you need to perform multiple knowledge graph operations, make all tool calls in parallel within a single response.";
    fs.writeFileSync(systemPromptPath, SEARCH_SYSTEM_PROMPT + suffix);

    const prompt = "Find information relevant to this user message:\\n\\n" + query;
    const args = [
      "--print", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--model", "${cliModel}", "--dangerously-skip-permissions",
      "--mcp-config", mcpConfigPath, "--strict-mcp-config",
      "--disallowedTools", ...BLOCKED,
      "--append-system-prompt-file", systemPromptPath,
      "--setting-sources", "", "--no-session-persistence", "--max-turns", "15",
      prompt,
    ];

    let proc;
    try {
      proc = spawn("claude", args, {
        cwd: invDir,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, SHELL: process.env.SHELL, TERM: process.env.TERM },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      cleanup(invDir);
      resolve("");
      return;
    }

    proc.stdin.end();
    let textOutput = "";
    let lineBuf = "";
    // Per-block tracking for tool call args accumulation
    const blockMeta = new Map(); // index -> { id, name, argsJson }

    proc.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split("\\n");
      lineBuf = lines.pop() || "";
      for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        let msg;
        try { msg = JSON.parse(trimmed); } catch { continue; }

        // Tool results arrive as top-level { type: "user" } messages, NOT as stream_events
        if (msg.type === "user") {
          const content = msg.message && msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_result") {
                const tcId = "search__" + block.tool_use_id;
                const result = typeof block.content === "string" ? block.content :
                  Array.isArray(block.content) ? block.content.map(c => c.text || "").join("") : "";
                sendToSocket("tool_result", JSON.stringify({ toolCallId: tcId, result, isError: block.is_error === true }));
              }
            }
          }
          continue;
        }

        if (msg.type !== "stream_event") continue;
        const evt = msg.event;
        if (!evt) continue;

        if (evt.type === "content_block_start" && evt.content_block) {
          if (evt.content_block.type === "tool_use") {
            const tcId = "search__" + (evt.content_block.id || "tool_" + evt.index);
            const tcName = evt.content_block.name || "unknown";
            blockMeta.set(evt.index, { id: tcId, name: tcName, argsJson: "" });
            sendToSocket("tool_call_start", JSON.stringify({ toolCallId: tcId, toolName: tcName }));
          }
        } else if (evt.type === "content_block_delta" && evt.delta) {
          if (evt.delta.type === "text_delta" && evt.delta.text) {
            textOutput += evt.delta.text;
          } else if (evt.delta.type === "input_json_delta" && evt.delta.partial_json !== undefined) {
            const bm = blockMeta.get(evt.index);
            if (bm) bm.argsJson += evt.delta.partial_json;
          }
        } else if (evt.type === "content_block_stop") {
          const bm = blockMeta.get(evt.index);
          if (bm) {
            let args = {};
            try { args = bm.argsJson ? JSON.parse(bm.argsJson) : {}; } catch {}
            sendToSocket("tool_call_args", JSON.stringify({ toolCallId: bm.id, toolName: bm.name, args }));
            blockMeta.delete(evt.index);
          }
        }
      }
    });

    proc.stderr.on("data", () => {});

    const finish = () => {
      cleanup(invDir);
      const match = textOutput.match(/<memory_context>([\\s\\S]*?)<\\/memory_context>/);
      resolve(match ? match[1].trim() : "");
    };

    proc.on("close", finish);
    proc.on("error", finish);
  });
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

rl.on("line", async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const id = req.id;

  switch (req.method) {
    case "initialize":
      send({ jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "coordinator", version: "1.0.0" },
      }});
      break;
    case "notifications/initialized":
      break;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: [{
        name: "search_memories",
        description: "Search the user's memory graph for information relevant to a query. Spawns a search agent that explores the graph using multiple strategies and returns a summary of relevant facts.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "What to search for in the user's memories" } },
          required: ["query"],
        },
      }]}});
      break;
    case "tools/call": {
      const toolName = req.params?.name;
      const query = req.params?.arguments?.query || "";
      if (toolName === "search_memories") {
        sendToSocket("search_phase", JSON.stringify({ status: "start" }));
        const result = await runSearchAgent(query);
        sendToSocket("search_phase", JSON.stringify({ status: "end" }));
        send({ jsonrpc: "2.0", id, result: {
          content: [{ type: "text", text: result || "No relevant memories found." }],
        }});
      } else {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool: " + toolName } });
      }
      break;
    }
    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
      }
  }
});
`;
	return writeScript(dir, "coordinator-mcp.js", script);
}
