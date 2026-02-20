import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawlerReport, Finding } from "../types.js";

// Mock cli-chat before importing crawler
vi.mock("../../cli-chat.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../cli-chat.js")>();
	return {
		...actual,
		LLM_MODEL: "test-model",
		spawnCli: vi.fn(),
		writeSystemPrompt: vi.fn(() => "/tmp/prompt.txt"),
		writeMcpConfig: vi.fn(() => "/tmp/config.json"),
		createInvocationDir: vi.fn(() => "/tmp/inv"),
		cleanupDir: vi.fn(),
		getCliModel: vi.fn(() => "sonnet"),
		createStreamParser: vi.fn(() => ({
			process: vi.fn(),
		})),
		pipeStdout: vi.fn(),
	};
});

vi.mock("../../agent-tools.js", () => ({
	getDisallowedTools: vi.fn(() => ["Bash"]),
}));

import { spawnCli } from "../../cli-chat.js";
import { spawnCrawler, spawnCrawlers } from "../crawler.js";

function createMockProc(textToEmit?: string) {
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
	return {
		stdout: {
			on: vi.fn((event: string, handler: (data: Buffer) => void) => {
				if (event === "data" && textToEmit)
					setTimeout(() => handler(Buffer.from(textToEmit)), 5);
			}),
		},
		stderr: { on: vi.fn() },
		stdin: { end: vi.fn() },
		on: vi.fn((event: string, cb: () => void) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(cb);
			if (event === "close") setTimeout(cb, 20);
		}),
		kill: vi.fn(),
	};
}

const defaultCrawlerOpts = {
	subtreeRootId: "cat1",
	subtreeContent: "Category 1",
	crawlerIndex: 1,
	mcpServerPath: "/mcp",
	graphSummary: "Summary",
	preScanFindings: [] as Finding[],
};

const defaultCrawlersOpts = {
	mcpServerPath: "/mcp",
	graphSummary: "Summary",
	preScanFindings: [] as Finding[],
};

describe("crawler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns empty report when CLI spawn fails", async () => {
		(spawnCli as Mock).mockImplementation(() => {
			throw new Error("spawn failed");
		});

		const report = await spawnCrawler(defaultCrawlerOpts);

		expect(report.subtreeRoot).toBe("cat1");
		expect(report.findings).toHaveLength(0);
		expect(report.nodesExplored).toBe(0);
	});

	it("spawns CLI with correct args", async () => {
		(spawnCli as Mock).mockReturnValue(createMockProc());

		await spawnCrawler(defaultCrawlerOpts);

		expect(spawnCli).toHaveBeenCalledTimes(1);
		const args = (spawnCli as Mock).mock.calls[0][0] as string[];
		expect(args).toContain("--max-turns");
		expect(args).toContain("10");
		expect(args).toContain("--dangerously-skip-permissions");
	});

	describe("spawnCrawlers", () => {
		it("caps at 8 crawlers by combining small subtrees", async () => {
			(spawnCli as Mock).mockReturnValue(createMockProc());

			const subtrees = Array.from({ length: 12 }, (_, i) => ({
				id: `cat${i}`,
				content: `Category ${i}`,
			}));

			await spawnCrawlers({ ...defaultCrawlersOpts, subtrees });

			expect(spawnCli).toHaveBeenCalledTimes(8);
		});

		it("spawns one crawler per subtree when under limit", async () => {
			(spawnCli as Mock).mockReturnValue(createMockProc());

			const subtrees = [
				{ id: "cat1", content: "Cat 1" },
				{ id: "cat2", content: "Cat 2" },
				{ id: "cat3", content: "Cat 3" },
			];

			const reports = await spawnCrawlers({ ...defaultCrawlersOpts, subtrees });

			expect(spawnCli).toHaveBeenCalledTimes(3);
			expect(reports).toHaveLength(3);
		});
	});
});
