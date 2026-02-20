import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { getDisallowedTools } from "./agent-tools.js";
import { createLogger } from "../logger.js";

const log = createLogger("maintenance");
import type { SSEEmitter, ToolCallData } from "./cli-chat.js";
import {
	cleanupDir,
	createInvocationDir,
	createStreamParser,
	pipeStdout,
	spawnCli,
	writeMcpConfig,
	writeSystemPrompt,
} from "./cli-chat.js";

const MAINTENANCE_SYSTEM_PROMPT = `You are a knowledge graph maintenance agent. Your job is to analyze and clean up a knowledge graph, performing these operations IN ORDER:

1. ORPHAN CLEANUP: Use get_context on the root node (depth 3) to see the graph structure. Look for structural issues — nodes that seem misplaced, empty categories, or orphaned branches. Delete any clearly empty or useless nodes.

2. TEMPORAL EXPIRY: Use search_nodes to find facts that might have time-limited validity (job titles, addresses, ages, "currently" statements). Check if any seem outdated and update or delete them.

3. DUPLICATE MERGING: Use search_nodes with different queries to find semantically similar nodes. If you find near-duplicates, keep the more detailed/recent one and delete the other. Update links if needed.

4. CONTRADICTION DETECTION: Use search_nodes to find facts that might conflict. If you find contradictions, resolve by keeping the more recent or higher-confidence fact. Add a reason when updating.

5. CATEGORY REBALANCING: Use get_context on root to analyze tree structure. If any category has too many direct children (>10), consider creating sub-collections to organize them. If the tree is too deep (>5 levels), consider flattening.

RULES:
- Be conservative — only make changes you're confident about.
- Always explain your reasoning.
- Use search_nodes to find related information before making changes.
- When deleting, verify the node isn't referenced by important links.
- When merging, preserve the more detailed content.

Do NOT produce conversational text. Only make tool calls and brief explanations.`;

const MAINTENANCE_THRESHOLD = process.env.MAINTENANCE_THRESHOLD
	? Number.parseInt(process.env.MAINTENANCE_THRESHOLD, 10)
	: 5;

export interface MaintenanceJob {
	id: string;
	status: "running" | "complete" | "error";
	trigger: "manual" | "auto";
	toolCalls: ToolCallData[];
	startedAt: Date;
	completedAt?: Date;
}

export interface MaintenanceStatus {
	currentJob: MaintenanceJob | null;
	conversationsSinceLastMaintenance: number;
	threshold: number;
}

let currentJob: MaintenanceJob | null = null;
let conversationsSinceLastMaintenance = 0;

export function runMaintenance(options: {
	trigger: "manual" | "auto";
	mcpServerPath: string;
}): MaintenanceJob | null {
	// Guard against concurrent runs
	if (currentJob?.status === "running") {
		return null;
	}

	const job: MaintenanceJob = {
		id: randomUUID(),
		status: "running",
		trigger: options.trigger,
		toolCalls: [],
		startedAt: new Date(),
	};
	currentJob = job;
	log.info("Job started", { id: job.id, trigger: options.trigger });

	const invocationDir = createInvocationDir();
	const mcpConfigPath = writeMcpConfig(invocationDir, options.mcpServerPath);
	const systemPromptPath = writeSystemPrompt(
		invocationDir,
		MAINTENANCE_SYSTEM_PROMPT,
	);

	const prompt =
		"Perform a full maintenance pass on the knowledge graph. Follow the steps in your system prompt.";

	const args = [
		"--print",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--model",
		"opus",
		"--dangerously-skip-permissions",
		"--mcp-config",
		mcpConfigPath,
		"--strict-mcp-config",
		"--disallowedTools",
		...getDisallowedTools("maintenance"),
		"--append-system-prompt-file",
		systemPromptPath,
		"--setting-sources",
		"",
		"--no-session-persistence",
		"--max-turns",
		"15",
		prompt,
	];

	// Create a maintenance branch so changes are isolated (like Dependabot)
	const branchName = `maintenance/${job.id.slice(0, 8)}`;
	let originalBranch: string | null = null;
	try {
		const graphPath =
			process.env.WILLOW_GRAPH_PATH ??
			resolve(homedir(), ".willow", "graph.json");
		const store = JsGraphStore.open(graphPath);
		try {
			store.currentBranch();
		} catch {
			try {
				store.vcsInit();
			} catch {
				/* already initialized */
			}
		}
		originalBranch = store.currentBranch();
		store.createBranch(branchName);
		store.switchBranch(branchName);
	} catch {
		// If branching fails, fall through — finish() will still commit on whatever branch
	}

	let proc: ReturnType<typeof spawnCli>;
	try {
		proc = spawnCli(args, invocationDir);
	} catch {
		log.error("CLI spawn failed", { jobId: job.id });
		// Restore original branch on spawn failure
		if (originalBranch) {
			try {
				const graphPath =
					process.env.WILLOW_GRAPH_PATH ??
					resolve(homedir(), ".willow", "graph.json");
				const store = JsGraphStore.open(graphPath);
				store.switchBranch(originalBranch);
				store.deleteBranch(branchName);
			} catch {
				/* best effort */
			}
		}
		cleanupDir(invocationDir);
		job.status = "error";
		job.completedAt = new Date();
		return job;
	}

	// Emit tool call events with maintenance__ prefix
	const maintenanceEmitter: SSEEmitter = (event, data) => {
		try {
			const parsed = JSON.parse(data);
			if (event === "tool_call_start") {
				const prefixedId = `maintenance__${parsed.toolCallId}`;
				job.toolCalls.push({
					toolCallId: prefixedId,
					toolName: parsed.toolName as string,
					args: {},
					phase: "indexer",
				});
			} else if (event === "tool_call_args") {
				const prefixedId = `maintenance__${parsed.toolCallId}`;
				const tc = job.toolCalls.find((t) => t.toolCallId === prefixedId);
				if (tc) tc.args = parsed.args as Record<string, unknown>;
			} else if (event === "tool_result") {
				const prefixedId = `maintenance__${parsed.toolCallId}`;
				const tc = job.toolCalls.find((t) => t.toolCallId === prefixedId);
				if (tc) {
					tc.result = parsed.result as string;
					tc.isError = parsed.isError as boolean;
				}
			}
			// Content from maintenance agent is silently discarded
		} catch {
			log.debug("Emitter parse error");
		}
	};

	const parser = createStreamParser(maintenanceEmitter);
	proc.stdin?.end();

	pipeStdout(proc, parser);

	proc.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString().trim();
		if (text) log.debug("stderr", { text: text.slice(0, 1000) });
	});

	const finish = () => {
		cleanupDir(invocationDir);
		if (job.status === "running") {
			job.status = "complete";
		}
		job.completedAt = new Date();
		log.info("Job complete", { id: job.id, toolCalls: job.toolCalls.length });
		conversationsSinceLastMaintenance = 0;

		// Commit on maintenance branch, switch back, merge (like Dependabot)
		try {
			const graphPath =
				process.env.WILLOW_GRAPH_PATH ??
				resolve(homedir(), ".willow", "graph.json");
			const store = JsGraphStore.open(graphPath);

			if (store.hasPendingChanges()) {
				store.commit({
					message: `Maintenance: ${job.trigger} run`,
					source: "maintenance",
					jobId: job.id,
					conversationId: undefined,
					summary: undefined,
					toolName: undefined,
				});
			}

			// Merge maintenance branch back and clean up
			if (originalBranch && store.currentBranch() === branchName) {
				store.switchBranch(originalBranch);
				try {
					store.mergeBranch(branchName);
				} catch {
					// Merge conflict — changes stay on the maintenance branch
				}
				try {
					store.deleteBranch(branchName);
				} catch {
					/* best effort cleanup */
				}
			}
		} catch {
			log.warn("VCS commit failed after maintenance");
		}
	};

	const finishWithError = () => {
		cleanupDir(invocationDir);
		if (job.status === "running") {
			job.status = "error";
		}
		job.completedAt = new Date();
		log.error("Job failed", { id: job.id });

		// Discard maintenance branch on error
		if (originalBranch) {
			try {
				const graphPath =
					process.env.WILLOW_GRAPH_PATH ??
					resolve(homedir(), ".willow", "graph.json");
				const store = JsGraphStore.open(graphPath);
				if (store.currentBranch() === branchName) {
					store.discardChanges();
					store.switchBranch(originalBranch);
				}
				store.deleteBranch(branchName);
			} catch {
				/* best effort */
			}
		}
	};

	proc.on("close", finish);
	proc.on("error", finishWithError);

	return job;
}

export function notifyConversationComplete(mcpServerPath: string): void {
	conversationsSinceLastMaintenance++;
	log.debug("Conversation count incremented", { count: conversationsSinceLastMaintenance });

	if (
		conversationsSinceLastMaintenance >= MAINTENANCE_THRESHOLD &&
		currentJob?.status !== "running"
	) {
		log.info("Auto-maintenance threshold reached", { count: conversationsSinceLastMaintenance });
		// Delay to let the indexer finish first
		setTimeout(() => {
			runMaintenance({ trigger: "auto", mcpServerPath });
		}, 15_000);
	}
}

export function getMaintenanceStatus(): MaintenanceStatus {
	return {
		currentJob,
		conversationsSinceLastMaintenance,
		threshold: MAINTENANCE_THRESHOLD,
	};
}
