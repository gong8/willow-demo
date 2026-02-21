import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createLogger } from "../logger.js";
import { BLOCKED_BUILTIN_TOOLS, getDisallowedTools } from "./agent-tools.js";
import { LineBuffer } from "./line-buffer.js";

const log = createLogger("cli-chat");

export { BLOCKED_BUILTIN_TOOLS };

const BASE_TEMP_DIR = join(tmpdir(), "willow-cli");
export const LLM_MODEL = process.env.LLM_MODEL || "claude-opus-4-6";
const CLI_IMAGE_MAX_DIM = 1536;
const CLI_IMAGE_QUALITY = 80;

export function getCliModel(model: string): string {
	if (model.includes("opus")) return "opus";
	if (model.includes("haiku")) return "haiku";
	return "sonnet";
}

export function createInvocationDir(): string {
	const dir = join(BASE_TEMP_DIR, randomUUID().slice(0, 12));
	mkdirSync(dir, { recursive: true });
	return dir;
}

async function resizeImagesForCli(
	images: string[],
	dir: string,
): Promise<string[]> {
	return Promise.all(
		images.map(async (src, i) => {
			const outPath = join(dir, `image_${i}.jpg`);
			try {
				await sharp(src)
					.resize(CLI_IMAGE_MAX_DIM, CLI_IMAGE_MAX_DIM, {
						fit: "inside",
						withoutEnlargement: true,
					})
					.jpeg({ quality: CLI_IMAGE_QUALITY })
					.toFile(outPath);
				return outPath;
			} catch {
				log.warn("Image resize failed", { index: i });
				return src;
			}
		}),
	);
}

export function writeTempFile(
	dir: string,
	filename: string,
	content: string,
): string {
	const filePath = join(dir, filename);
	writeFileSync(filePath, content);
	return filePath;
}

function writeImageViewerMcp(dir: string, allowedPaths: string[]): string {
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
	return writeTempFile(dir, "image-viewer-mcp.js", script);
}

export interface CoordinatorConfig {
	/** Path to the event socket for sub-agent event forwarding. */
	eventSocketPath: string;
	/** Path to the willow MCP server entry point (for the search sub-agent). */
	mcpServerPath: string;
}

function getGraphPath(): string {
	return (
		process.env.WILLOW_GRAPH_PATH ||
		join(process.env.HOME || "~", ".willow", "graph.json")
	);
}

function nodeStdioServer(scriptPath: string): Record<string, unknown> {
	return { type: "stdio", command: "node", args: [scriptPath] };
}

function writeCoordinatorMcp(
	dir: string,
	config: CoordinatorConfig,
	scopeNodeId?: string,
): string {
	const graphPath = getGraphPath();

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
const SCOPE_NODE_ID = ${JSON.stringify(scopeNodeId ?? "")};

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
    const willowEnv = { WILLOW_GRAPH_PATH: GRAPH_PATH };
    if (SCOPE_NODE_ID) willowEnv.WILLOW_SCOPE_NODE_ID = SCOPE_NODE_ID;
    fs.writeFileSync(mcpConfigPath, JSON.stringify({
      mcpServers: {
        willow: { type: "stdio", command: "node", args: [MCP_SERVER_PATH], env: willowEnv }
      }
    }));

    const systemPromptPath = path.join(invDir, "system-prompt.txt");
    const suffix = "\\nIMPORTANT CONSTRAINTS:\\n- Only use MCP tools prefixed with mcp__willow__ to manage the knowledge graph.\\n- Never attempt to use filesystem, code editing, web browsing, or any non-MCP tools.\\n- When you need to perform multiple knowledge graph operations, make all tool calls in parallel within a single response.";
    fs.writeFileSync(systemPromptPath, SEARCH_SYSTEM_PROMPT + suffix);

    const prompt = "Find information relevant to this user message:\\n\\n" + query;
    const args = [
      "--print", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--model", "${getCliModel(LLM_MODEL)}", "--dangerously-skip-permissions",
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
	return writeTempFile(dir, "coordinator-mcp.js", script);
}

export function writeMcpConfig(
	dir: string,
	mcpServerPath: string,
	options?: {
		imagePaths?: string[];
		coordinator?: CoordinatorConfig;
		scopeNodeId?: string;
	},
): string {
	const willowEnv: Record<string, string> = {
		WILLOW_GRAPH_PATH: getGraphPath(),
	};
	if (options?.scopeNodeId) {
		willowEnv.WILLOW_SCOPE_NODE_ID = options.scopeNodeId;
	}
	const servers: Record<string, unknown> = {
		willow: {
			...nodeStdioServer(mcpServerPath),
			env: willowEnv,
		},
	};

	if (options?.imagePaths?.length) {
		servers.images = nodeStdioServer(
			writeImageViewerMcp(dir, options.imagePaths),
		);
	}
	if (options?.coordinator) {
		servers.coordinator = nodeStdioServer(
			writeCoordinatorMcp(dir, options.coordinator, options?.scopeNodeId),
		);
	}

	return writeTempFile(
		dir,
		"mcp-config.json",
		JSON.stringify({ mcpServers: servers }),
	);
}

export function writeSystemPrompt(
	dir: string,
	content: string,
	options?: { allowWebTools?: boolean },
): string {
	const toolLine = options?.allowWebTools
		? "- Only use MCP tools prefixed with mcp__willow__ or mcp__coordinator__ to manage the knowledge graph and search memories.\n- You may use WebSearch and WebFetch to look up information on the web when helpful."
		: "- Only use MCP tools prefixed with mcp__willow__ to manage the knowledge graph.\n- Never attempt to use filesystem, code editing, web browsing, or any non-MCP tools.";
	const suffix = `\nIMPORTANT CONSTRAINTS:\n${toolLine}\n- When you need to perform multiple knowledge graph operations, make all tool calls in parallel within a single response.`;
	return writeTempFile(dir, "system-prompt.txt", content + suffix);
}

interface CliMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	phase?: "search" | "chat" | "indexer";
}

export interface CliChatOptions {
	messages: CliMessage[];
	systemPrompt: string;
	model?: string;
	signal?: AbortSignal;
	mcpServerPath: string;
	/** All images in the conversation (for MCP tool access). */
	images?: string[];
	/** Only images attached to the latest user message (for prompt instruction). */
	newImages?: string[];
	/** Tools to block — defaults to BLOCKED_BUILTIN_TOOLS if not provided. */
	disallowedTools?: string[];
	/** Coordinator MCP config for sub-agent communication. */
	coordinator?: CoordinatorConfig;
	/** Allow WebFetch/WebSearch in system prompt constraints. */
	allowWebTools?: boolean;
	/** If set, restricts agents to this subtree of the knowledge graph. */
	scopeNodeId?: string;
}

function buildPrompt(messages: CliMessage[], newImages?: string[]): string {
	const parts: string[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant")
			parts.push(`<previous_response>\n${msg.content}\n</previous_response>`);
		else if (msg.role === "user") parts.push(msg.content);
	}

	if (newImages?.length) {
		const imageList = newImages.map((p) => `  - ${p}`).join("\n");
		parts.push(
			`<attached_images>\nThe user has attached new images. Use the mcp__images__view_image tool to view each image:\n${imageList}\n</attached_images>`,
		);
	}

	return parts.join("\n\n").trim();
}

function buildCliArgs(
	model: string,
	mcpConfigPath: string,
	systemPromptPath: string,
	disallowedTools: string[],
	prompt: string,
): string[] {
	return [
		"--print",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--model",
		model,
		"--dangerously-skip-permissions",
		"--mcp-config",
		mcpConfigPath,
		"--strict-mcp-config",
		"--disallowedTools",
		...disallowedTools,
		"--append-system-prompt-file",
		systemPromptPath,
		"--setting-sources",
		"",
		"--no-session-persistence",
		"--max-turns",
		"50",
		prompt,
	];
}

type BlockType = "text" | "tool_use" | "thinking";
export type SSEEmitter = (event: string, data: string) => void;

function extractToolResultText(
	blockContent: string | Array<Record<string, unknown>> | undefined,
): string {
	if (typeof blockContent === "string") return blockContent;
	if (Array.isArray(blockContent)) {
		return blockContent.map((c) => (c.text as string) || "").join("");
	}
	return "";
}

function emitUserToolResults(
	msg: Record<string, unknown>,
	emitSSE: SSEEmitter,
): void {
	const message = msg.message as Record<string, unknown> | undefined;
	const content =
		message?.role === "user"
			? (message.content as Array<Record<string, unknown>> | undefined)
			: undefined;
	if (!content) return;
	for (const block of content) {
		if (block.type !== "tool_result") continue;
		emitSSE(
			"tool_result",
			JSON.stringify({
				toolCallId: block.tool_use_id as string,
				result: extractToolResultText(
					block.content as string | Array<Record<string, unknown>> | undefined,
				),
				isError: block.is_error === true,
			}),
		);
	}
}

export function createStreamParser(emitSSE: SSEEmitter) {
	const blockTypes = new Map<number, BlockType>();
	const toolCalls = new Map<
		number,
		{ id: string; name: string; argsJson: string }
	>();

	function handleBlockStart(
		index: number,
		block: Record<string, unknown>,
	): void {
		const blockType = block.type as string;
		if (blockType === "tool_use") {
			blockTypes.set(index, "tool_use");
			const toolCallId = (block.id as string) || `tool_${index}`;
			const toolName = (block.name as string) || "unknown";
			toolCalls.set(index, { id: toolCallId, name: toolName, argsJson: "" });
			emitSSE("tool_call_start", JSON.stringify({ toolCallId, toolName }));
		} else if (blockType === "thinking") {
			blockTypes.set(index, "thinking");
			emitSSE("thinking_start", JSON.stringify({}));
		} else {
			blockTypes.set(index, "text");
		}
	}

	function handleBlockDelta(
		index: number,
		delta: Record<string, unknown>,
	): void {
		const deltaType = delta.type as string;
		const blockType = blockTypes.get(index);

		if (deltaType === "text_delta" && delta.text && blockType === "text") {
			emitSSE("content", JSON.stringify({ content: delta.text as string }));
		} else if (
			deltaType === "input_json_delta" &&
			delta.partial_json !== undefined
		) {
			const tc = toolCalls.get(index);
			if (tc) tc.argsJson += delta.partial_json as string;
		} else if (deltaType === "thinking_delta" && delta.thinking) {
			emitSSE(
				"thinking_delta",
				JSON.stringify({ text: delta.thinking as string }),
			);
		}
	}

	function handleBlockStop(index: number): void {
		if (blockTypes.get(index) !== "tool_use") return;
		const tc = toolCalls.get(index);
		if (!tc) return;
		let args: Record<string, unknown> = {};
		try {
			args = tc.argsJson ? JSON.parse(tc.argsJson) : {};
		} catch {
			log.debug("Tool call args parse failed");
		}
		emitSSE(
			"tool_call_args",
			JSON.stringify({ toolCallId: tc.id, toolName: tc.name, args }),
		);
	}

	function processEvent(event: Record<string, unknown>): void {
		const index = event.index as number;
		switch (event.type as string) {
			case "content_block_start":
				handleBlockStart(index, event.content_block as Record<string, unknown>);
				break;
			case "content_block_delta":
				handleBlockDelta(index, event.delta as Record<string, unknown>);
				break;
			case "content_block_stop":
				handleBlockStop(index);
				break;
			case "message_start":
				emitUserToolResults(event, emitSSE);
				break;
		}
	}

	return {
		process(msg: Record<string, unknown>): void {
			if (msg.type === "user") {
				emitUserToolResults(msg, emitSSE);
				return;
			}
			if (msg.type !== "stream_event") return;
			const event = msg.event as Record<string, unknown> | undefined;
			if (event) processEvent(event);
		},
	};
}

export function spawnCli(
	args: string[],
	cwd: string,
): ChildProcessWithoutNullStreams {
	return spawn("claude", args, {
		cwd,
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			SHELL: process.env.SHELL,
			TERM: process.env.TERM,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
}

export function pipeStdout(
	proc: ChildProcessWithoutNullStreams,
	parser: ReturnType<typeof createStreamParser>,
): void {
	const lineBuffer = new LineBuffer();
	proc.stdout?.on("data", (chunk: Buffer) => {
		for (const line of lineBuffer.push(chunk.toString())) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let msg: Record<string, unknown>;
			try {
				msg = JSON.parse(trimmed);
			} catch {
				continue;
			}
			parser.process(msg);
		}
	});
}

export function cleanupDir(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		log.debug("Cleanup dir failed");
	}
}

function trySpawnCli(
	args: string[],
	cwd: string,
	emitSSE: SSEEmitter,
): ChildProcessWithoutNullStreams | null {
	try {
		return spawnCli(args, cwd);
	} catch (err) {
		log.error("CLI spawn failed");
		const msg = err instanceof Error ? err.message : "Unknown spawn error";
		emitSSE("error", JSON.stringify({ error: msg }));
		return null;
	}
}

function wireProcessLifecycle(
	proc: ChildProcessWithoutNullStreams,
	emitSSE: SSEEmitter,
	parser: ReturnType<typeof createStreamParser>,
	invocationDir: string,
	signal?: AbortSignal,
): Promise<void> {
	proc.stdin?.end();
	signal?.addEventListener("abort", () => proc.kill("SIGTERM"));

	pipeStdout(proc, parser);
	proc.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString().trim();
		if (text) log.debug("stderr", { text: text.slice(0, 1000) });
	});

	let done = false;
	const finish = (errorMsg?: string): void => {
		if (done) return;
		done = true;
		if (errorMsg) emitSSE("error", JSON.stringify({ error: errorMsg }));
		emitSSE("done", "[DONE]");
		cleanupDir(invocationDir);
	};

	return new Promise((resolve) => {
		proc.on("close", () => {
			log.info("Process closed");
			finish();
			resolve();
		});
		proc.on("error", (err) => {
			log.error("Process error");
			finish(err.message);
			resolve();
		});
	});
}

function mapNewImagePaths(
	originals: string[],
	resized: string[],
	newImages: string[],
): string[] | undefined {
	if (!newImages.length) return undefined;
	const newSet = new Set(newImages);
	const mapped = originals
		.map((orig, i) => (newSet.has(orig) ? resized[i] : null))
		.filter((p): p is string => p !== null);
	return mapped.length ? mapped : undefined;
}

async function prepareInvocation(options: CliChatOptions): Promise<{
	invocationDir: string;
	args: string[];
}> {
	const invocationDir = createInvocationDir();
	const systemPromptPath = writeSystemPrompt(
		invocationDir,
		options.systemPrompt,
		{ allowWebTools: options.allowWebTools },
	);
	const model = getCliModel(options.model ?? LLM_MODEL);
	const origImages = options.images ?? [];
	const cliImagePaths = origImages.length
		? await resizeImagesForCli(origImages, invocationDir)
		: origImages;
	const cliNewImagePaths = origImages.length
		? mapNewImagePaths(origImages, cliImagePaths, options.newImages ?? [])
		: undefined;

	const mcpConfigPath = writeMcpConfig(invocationDir, options.mcpServerPath, {
		imagePaths: cliImagePaths.length ? cliImagePaths : undefined,
		coordinator: options.coordinator,
		scopeNodeId: options.scopeNodeId,
	});
	const prompt =
		buildPrompt(options.messages, cliNewImagePaths) ||
		(cliNewImagePaths?.length ? "Describe this image." : "Hello");
	const args = buildCliArgs(
		model,
		mcpConfigPath,
		systemPromptPath,
		options.disallowedTools ?? BLOCKED_BUILTIN_TOOLS,
		prompt,
	);

	log.info("Invocation prepared", { model: options.model ?? "default" });
	return { invocationDir, args };
}

export function streamCliChat(
	options: CliChatOptions,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();

	return new ReadableStream({
		async start(controller) {
			let closed = false;
			const emit: SSEEmitter = (event, data) => {
				if (closed) return;
				controller.enqueue(
					encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
				);
			};
			const close = () => {
				if (closed) return;
				closed = true;
				controller.close();
			};

			const { invocationDir, args } = await prepareInvocation(options);

			const proc = trySpawnCli(args, invocationDir, emit);
			if (!proc) {
				emit("done", "[DONE]");
				close();
				return;
			}

			const parser = createStreamParser(emit);
			proc.on("close", close);
			proc.on("error", close);
			wireProcessLifecycle(proc, emit, parser, invocationDir, options.signal);
		},
	});
}

/**
 * Promise-based chat agent that emits SSE events via callback.
 * Used by combined-stream to run the chat phase without creating a ReadableStream.
 */
export async function runChatAgent(
	options: CliChatOptions,
	emitSSE: SSEEmitter,
): Promise<void> {
	const { invocationDir, args } = await prepareInvocation(options);

	const proc = trySpawnCli(args, invocationDir, emitSSE);
	if (!proc) {
		cleanupDir(invocationDir);
		return;
	}

	const parser = createStreamParser(emitSSE);
	await wireProcessLifecycle(
		proc,
		emitSSE,
		parser,
		invocationDir,
		options.signal,
	);
}
