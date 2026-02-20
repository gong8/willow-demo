import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProc, mockCliChatUtils } from "../../__tests__/helpers";
import type { Finding } from "../types.js";

vi.mock("../../cli-chat.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../cli-chat.js")>();
	return { ...actual, ...mockCliChatUtils() };
});

vi.mock("../../agent-tools.js", () => ({
	getDisallowedTools: vi.fn(() => ["Bash"]),
}));

import { spawnCli } from "../../cli-chat.js";
import { spawnCrawler, spawnCrawlers } from "../crawler.js";

const sharedOpts = {
	mcpServerPath: "/mcp",
	graphSummary: "Summary",
	preScanFindings: [] as Finding[],
};

const defaultCrawlerOpts = {
	...sharedOpts,
	subtreeRootId: "cat1",
	subtreeContent: "Category 1",
	crawlerIndex: 1,
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

			await spawnCrawlers({ ...sharedOpts, subtrees });

			expect(spawnCli).toHaveBeenCalledTimes(8);
		});

		it("spawns one crawler per subtree when under limit", async () => {
			(spawnCli as Mock).mockReturnValue(createMockProc());

			const subtrees = [
				{ id: "cat1", content: "Cat 1" },
				{ id: "cat2", content: "Cat 2" },
				{ id: "cat3", content: "Cat 3" },
			];

			const reports = await spawnCrawlers({ ...sharedOpts, subtrees });

			expect(spawnCli).toHaveBeenCalledTimes(3);
			expect(reports).toHaveLength(3);
		});
	});
});
