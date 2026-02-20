import { createLogger } from "../logger.js";
import { getDisallowedTools } from "./agent-tools.js";
import type { SSEEmitter, ToolCallData } from "./cli-chat.js";
import {
	LLM_MODEL,
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	getCliModel,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "./cli-chat.js";

const log = createLogger("agent-runner");

type AgentName = Parameters<typeof getDisallowedTools>[0];

export interface AgentRunnerOptions {
	agentName: AgentName;
	systemPrompt: string;
	prompt: string;
	mcpServerPath: string;
	emitSSE: SSEEmitter;
	maxTurns?: string;
	signal?: AbortSignal;
	/** If provided, captures text output from content events. */
	captureText?: boolean;
}

export interface AgentRunnerResult {
	textOutput: string;
	toolCalls: ToolCallData[];
}

/**
 * Shared runner for sub-agents (search, indexer, etc.).
 * Handles CLI spawning, prefixed SSE forwarding, and process lifecycle.
 */
export function runAgent(
	options: AgentRunnerOptions,
): Promise<AgentRunnerResult> {
	const {
		agentName,
		systemPrompt,
		prompt,
		mcpServerPath,
		emitSSE,
		maxTurns = "10",
		signal,
		captureText = false,
	} = options;

	return new Promise((resolve) => {
		log.info(`${agentName} started`);
		const toolCalls: ToolCallData[] = [];
		let textOutput = "";
		const prefix = `${agentName}__`;

		const invocationDir = createInvocationDir();
		const mcpConfigPath = writeMcpConfig(invocationDir, mcpServerPath);
		const systemPromptPath = writeSystemPrompt(invocationDir, systemPrompt);

		const args = [
			"--print",
			"--output-format",
			"stream-json",
			"--verbose",
			"--include-partial-messages",
			"--model",
			getCliModel(LLM_MODEL),
			"--dangerously-skip-permissions",
			"--mcp-config",
			mcpConfigPath,
			"--strict-mcp-config",
			"--disallowedTools",
			...getDisallowedTools(agentName),
			"--append-system-prompt-file",
			systemPromptPath,
			"--setting-sources",
			"",
			"--no-session-persistence",
			"--max-turns",
			maxTurns,
			prompt,
		];

		let proc: ReturnType<typeof spawnCli>;
		try {
			proc = spawnCli(args, invocationDir);
		} catch {
			log.error(`${agentName} CLI spawn failed`);
			cleanupDir(invocationDir);
			resolve({ textOutput: "", toolCalls: [] });
			return;
		}

		const agentEmitter: SSEEmitter = (event, data) => {
			try {
				const parsed = JSON.parse(data);
				if (event === "tool_call_start") {
					const prefixedId = `${prefix}${parsed.toolCallId}`;
					toolCalls.push({
						toolCallId: prefixedId,
						toolName: parsed.toolName as string,
						args: {},
						phase: agentName as ToolCallData["phase"],
					});
					emitSSE(
						"tool_call_start",
						JSON.stringify({
							toolCallId: prefixedId,
							toolName: parsed.toolName,
						}),
					);
				} else if (event === "tool_call_args") {
					const prefixedId = `${prefix}${parsed.toolCallId}`;
					const tc = toolCalls.find((t) => t.toolCallId === prefixedId);
					if (tc) tc.args = parsed.args as Record<string, unknown>;
					emitSSE(
						"tool_call_args",
						JSON.stringify({
							toolCallId: prefixedId,
							toolName: parsed.toolName,
							args: parsed.args,
						}),
					);
				} else if (event === "tool_result") {
					const prefixedId = `${prefix}${parsed.toolCallId}`;
					const tc = toolCalls.find((t) => t.toolCallId === prefixedId);
					if (tc) {
						tc.result = parsed.result as string;
						tc.isError = parsed.isError as boolean;
					}
					emitSSE(
						"tool_result",
						JSON.stringify({
							toolCallId: prefixedId,
							result: parsed.result,
							isError: parsed.isError,
						}),
					);
				} else if (captureText && event === "content" && parsed.content) {
					textOutput += parsed.content;
				}
			} catch {
				log.debug("Emitter parse error");
			}
		};

		const parser = createStreamParser(agentEmitter);
		proc.stdin?.end();

		if (signal) {
			signal.addEventListener("abort", () => {
				proc.kill("SIGTERM");
			});
		}

		pipeStdout(proc, parser);

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString().trim();
			if (text) log.debug("stderr", { text: text.slice(0, 1000) });
		});

		const finish = () => {
			cleanupDir(invocationDir);
			log.info(`${agentName} complete`, {
				toolCalls: toolCalls.length,
			});
			resolve({ textOutput, toolCalls });
		};

		proc.on("close", finish);
		proc.on("error", finish);
	});
}
