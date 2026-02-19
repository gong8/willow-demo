import type { ToolCallData } from "./cli-chat.js";
import {
	BLOCKED_BUILTIN_TOOLS,
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "./cli-chat.js";

const INDEXER_SYSTEM_PROMPT = `You are a background knowledge-graph indexer. Your ONLY job is to analyze a conversation and update the user's knowledge graph with any new facts.

RULES:
1. First, use search_nodes to check what already exists — never create duplicates.
2. Use create_node to store genuinely new facts under appropriate categories. Create categories (node_type: "category" under root) if needed.
3. Use update_node if a fact updates or corrects something already stored. Provide a reason.
4. Use add_link to connect related facts across different categories.
5. Use delete_node to remove information that is clearly outdated or wrong.
6. If there is nothing new to store, do nothing.
7. Keep facts atomic — one fact per node.
8. Use meaningful metadata (source: "conversation", confidence: "high"/"medium").
9. Organize under broad categories: Work, Hobbies, Health, Relationships, Preferences, etc.

Do NOT respond to the user. Do NOT produce any conversational text. Only make tool calls.`;

export interface IndexerJob {
	conversationId: string;
	status: "running" | "complete" | "error";
	toolCalls: ToolCallData[];
	startedAt: number;
	completedAt?: number;
}

const jobs = new Map<string, IndexerJob>();

const AUTO_REMOVE_MS = 300_000; // 5 minutes

interface RunIndexerOptions {
	conversationId: string;
	userMessage: string;
	assistantResponse: string;
	mcpServerPath: string;
}

export function runIndexer(options: RunIndexerOptions): void {
	const { conversationId, userMessage, assistantResponse, mcpServerPath } =
		options;

	const job: IndexerJob = {
		conversationId,
		status: "running",
		toolCalls: [],
		startedAt: Date.now(),
	};
	jobs.set(conversationId, job);

	const invocationDir = createInvocationDir();
	const mcpConfigPath = writeMcpConfig(invocationDir, mcpServerPath);
	const systemPromptPath = writeSystemPrompt(
		invocationDir,
		INDEXER_SYSTEM_PROMPT,
	);

	const prompt = `<conversation>\nUser: ${userMessage}\nAssistant: ${assistantResponse}\n</conversation>\nAnalyze the above and update the knowledge graph with any new facts about the user.`;

	const args = [
		"--print",
		"--output-format",
		"stream-json",
		"--verbose",
		"--model",
		"opus",
		"--dangerously-skip-permissions",
		"--mcp-config",
		mcpConfigPath,
		"--strict-mcp-config",
		"--disallowedTools",
		...BLOCKED_BUILTIN_TOOLS,
		"--append-system-prompt-file",
		systemPromptPath,
		"--setting-sources",
		"",
		"--no-session-persistence",
		"--max-turns",
		"10",
		prompt,
	];

	let proc: ReturnType<typeof spawnCli>;
	try {
		proc = spawnCli(args, invocationDir);
	} catch {
		job.status = "error";
		job.completedAt = Date.now();
		cleanupDir(invocationDir);
		scheduleRemoval(conversationId);
		return;
	}

	// Dummy emitter that only extracts tool call data into the job
	const emitter = (event: string, data: string) => {
		try {
			const parsed = JSON.parse(data);
			if (event === "tool_call_start") {
				job.toolCalls.push({
					toolCallId: parsed.toolCallId as string,
					toolName: parsed.toolName as string,
					args: {},
				});
			} else if (event === "tool_call_args") {
				const tc = job.toolCalls.find(
					(t) => t.toolCallId === parsed.toolCallId,
				);
				if (tc) tc.args = parsed.args as Record<string, unknown>;
			} else if (event === "tool_result") {
				const tc = job.toolCalls.find(
					(t) => t.toolCallId === parsed.toolCallId,
				);
				if (tc) {
					tc.result = parsed.result as string;
					tc.isError = parsed.isError as boolean;
				}
			}
		} catch {
			// ignore parse errors
		}
	};

	const parser = createStreamParser(emitter);
	proc.stdin?.end();
	pipeStdout(proc, parser);

	proc.stderr?.on("data", () => {
		// silently discard
	});

	proc.on("close", () => {
		job.status = "complete";
		job.completedAt = Date.now();
		cleanupDir(invocationDir);
		scheduleRemoval(conversationId);
	});

	proc.on("error", () => {
		job.status = "error";
		job.completedAt = Date.now();
		cleanupDir(invocationDir);
		scheduleRemoval(conversationId);
	});
}

function scheduleRemoval(conversationId: string): void {
	setTimeout(() => {
		jobs.delete(conversationId);
	}, AUTO_REMOVE_MS);
}

export function getIndexerStatus(conversationId: string): IndexerJob | null {
	return jobs.get(conversationId) ?? null;
}
