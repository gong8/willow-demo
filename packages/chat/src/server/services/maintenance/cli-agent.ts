import { createLogger } from "../../logger";
import { getDisallowedTools } from "../agent-tools";
import {
	LLM_MODEL,
	type SSEEmitter,
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	getCliModel,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "../cli-chat";

type AgentRole = Parameters<typeof getDisallowedTools>[0];

const log = createLogger("cli-agent");

export interface CliAgentOptions {
	systemPrompt: string;
	userPrompt: string;
	mcpServerPath: string;
	role: AgentRole;
	maxTurns: number;
	/** Called for each stream event (event name, JSON data). */
	onEvent?: SSEEmitter;
}

/**
 * Spawn a Claude CLI agent with MCP config, collect output, and clean up.
 * Returns the concatenated text output from the agent.
 */
export function runCliAgent(options: CliAgentOptions): Promise<string> {
	return new Promise((resolve) => {
		const invocationDir = createInvocationDir();
		const mcpConfigPath = writeMcpConfig(invocationDir, options.mcpServerPath);
		const systemPromptPath = writeSystemPrompt(
			invocationDir,
			options.systemPrompt,
		);

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
			...getDisallowedTools(options.role),
			"--append-system-prompt-file",
			systemPromptPath,
			"--setting-sources",
			"",
			"--no-session-persistence",
			"--max-turns",
			String(options.maxTurns),
			options.userPrompt,
		];

		let proc: ReturnType<typeof spawnCli>;
		try {
			proc = spawnCli(args, invocationDir);
		} catch {
			log.error("Agent spawn failed", { role: options.role });
			cleanupDir(invocationDir);
			resolve("");
			return;
		}

		let textOutput = "";
		const emitter: SSEEmitter = (event, data) => {
			if (event === "content") {
				try {
					const parsed = JSON.parse(data);
					if (parsed.content) textOutput += parsed.content;
				} catch {
					/* ignore non-JSON chunks */
				}
			}
			options.onEvent?.(event, data);
		};

		const parser = createStreamParser(emitter);
		proc.stdin?.end();
		pipeStdout(proc, parser);

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString().trim();
			if (text)
				log.debug(`${options.role} stderr`, { text: text.slice(0, 500) });
		});

		const finish = () => {
			cleanupDir(invocationDir);
			resolve(textOutput);
		};

		proc.on("close", finish);
		proc.on("error", finish);
	});
}
