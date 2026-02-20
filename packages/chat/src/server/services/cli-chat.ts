import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createLogger } from "../logger.js";
import { BLOCKED_BUILTIN_TOOLS } from "./agent-tools.js";
import { LineBuffer } from "./line-buffer.js";
import {
	type CoordinatorConfig,
	writeCoordinatorMcp,
	writeImageViewerMcp,
} from "./mcp-scripts.js";
import {
	type SSEEmitter,
	type ToolCallData,
	createStreamParser,
} from "./stream-parser.js";

export { BLOCKED_BUILTIN_TOOLS };
export type { CoordinatorConfig, SSEEmitter, ToolCallData };
export { createStreamParser };

const log = createLogger("cli-chat");

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

function getGraphPath(): string {
	return (
		process.env.WILLOW_GRAPH_PATH ||
		join(process.env.HOME || "~", ".willow", "graph.json")
	);
}

function nodeStdioServer(scriptPath: string): Record<string, unknown> {
	return { type: "stdio", command: "node", args: [scriptPath] };
}

export function writeMcpConfig(
	dir: string,
	mcpServerPath: string,
	options?: {
		imagePaths?: string[];
		coordinator?: CoordinatorConfig;
	},
): string {
	const graphPath = getGraphPath();
	const servers: Record<string, unknown> = {
		willow: {
			...nodeStdioServer(mcpServerPath),
			env: { WILLOW_GRAPH_PATH: graphPath },
		},
	};

	if (options?.imagePaths?.length) {
		servers.images = nodeStdioServer(
			writeImageViewerMcp(dir, options.imagePaths),
		);
	}
	if (options?.coordinator) {
		servers.coordinator = nodeStdioServer(
			writeCoordinatorMcp(
				dir,
				options.coordinator,
				graphPath,
				getCliModel(LLM_MODEL),
			),
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

export interface CliChatOptions {
	messages: CliMessage[];
	systemPrompt: string;
	model?: string;
	signal?: AbortSignal;
	mcpServerPath: string;
	images?: string[];
	newImages?: string[];
	disallowedTools?: string[];
	coordinator?: CoordinatorConfig;
	allowWebTools?: boolean;
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
