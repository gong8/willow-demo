import { createLogger } from "../../logger.js";
import { getDisallowedTools } from "../agent-tools.js";
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
} from "../cli-chat.js";
import {
	buildEnhancementPassPrompt,
	buildFixPassPrompt,
	buildResolverSystemPrompt,
	buildResolverUserPrompt,
	needsSplitPasses,
} from "./resolver-prompt.js";
import type { CrawlerReport, Finding } from "./types.js";

const log = createLogger("resolver");

interface ResolverResult {
	actionsExecuted: number;
}

function runResolverPass(options: {
	userPrompt: string;
	mcpServerPath: string;
	maxTurns: number;
	onAction?: () => void;
}): Promise<ResolverResult> {
	return new Promise((resolve) => {
		const invocationDir = createInvocationDir();
		const mcpConfigPath = writeMcpConfig(invocationDir, options.mcpServerPath);
		const systemPromptPath = writeSystemPrompt(
			invocationDir,
			buildResolverSystemPrompt(),
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
			...getDisallowedTools("resolver"),
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
			log.error("Resolver spawn failed");
			cleanupDir(invocationDir);
			resolve({ actionsExecuted: 0 });
			return;
		}

		let toolCallCount = 0;

		const emitter = (event: string) => {
			if (event === "tool_call_start") {
				toolCallCount++;
				options.onAction?.();
			}
		};

		const parser = createStreamParser(emitter);
		proc.stdin?.end();
		pipeStdout(proc, parser);

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString().trim();
			if (text) log.debug("resolver stderr", { text: text.slice(0, 500) });
		});

		const finish = () => {
			cleanupDir(invocationDir);
			log.info("Resolver pass complete", { actionsExecuted: toolCallCount });
			resolve({ actionsExecuted: toolCallCount });
		};

		proc.on("close", finish);
		proc.on("error", finish);
	});
}

export async function spawnResolver(options: {
	preScanFindings: Finding[];
	crawlerReports: CrawlerReport[];
	mcpServerPath: string;
	onAction?: () => void;
}): Promise<ResolverResult> {
	const totalFindings =
		options.preScanFindings.length +
		options.crawlerReports.reduce((sum, r) => sum + r.findings.length, 0);

	if (totalFindings === 0) {
		log.info("No findings to resolve");
		return { actionsExecuted: 0 };
	}

	const prompts = needsSplitPasses(
		options.preScanFindings,
		options.crawlerReports,
	)
		? [
				buildFixPassPrompt(options.preScanFindings, options.crawlerReports),
				buildEnhancementPassPrompt(options.crawlerReports),
			]
		: [
				buildResolverUserPrompt(
					options.preScanFindings,
					options.crawlerReports,
				),
			];

	if (prompts.length > 1) {
		log.info("Split pass mode — too many findings", { totalFindings });
	}

	let actionsExecuted = 0;
	for (const userPrompt of prompts) {
		const result = await runResolverPass({
			userPrompt,
			mcpServerPath: options.mcpServerPath,
			maxTurns: 25,
			onAction: options.onAction,
		});
		actionsExecuted += result.actionsExecuted;
	}

	return { actionsExecuted };
}
