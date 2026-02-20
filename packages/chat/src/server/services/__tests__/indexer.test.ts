import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnCli } from "../cli-chat.js";
import { runIndexerAgent } from "../indexer.js";

const { mockCliUtils } = vi.hoisted(() => {
	function createProc() {
		return {
			stdout: { on: vi.fn() },
			stderr: { on: vi.fn() },
			stdin: { end: vi.fn() },
			on: vi.fn((event: string, cb: () => void) => {
				if (event === "close") setTimeout(cb, 5);
			}),
			kill: vi.fn(),
		};
	}
	return {
		mockCliUtils: () => ({
			spawnCli: vi.fn(() => createProc()),
			writeMcpConfig: vi.fn(() => "/tmp/mcp-config.json"),
			writeSystemPrompt: vi.fn(() => "/tmp/system-prompt.txt"),
			createInvocationDir: vi.fn(() => "/tmp/invocation"),
			cleanupDir: vi.fn(),
			BLOCKED_BUILTIN_TOOLS: [],
			createStreamParser: vi.fn(() => ({ process: vi.fn() })),
			pipeStdout: vi.fn(),
		}),
	};
});

vi.mock("../cli-chat.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../cli-chat.js")>();
	return { ...actual, ...mockCliUtils() };
});

describe("indexer agent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs the indexer agent with correct parameters", async () => {
		await runIndexerAgent({
			userMessage: "I like pizza",
			assistantResponse: "That's good to know",
			mcpServerPath: "/path/to/mcp",
			emitSSE: vi.fn(),
			signal: new AbortController().signal,
		});

		expect(spawnCli).toHaveBeenCalledTimes(1);

		const callArgs = vi.mocked(spawnCli).mock.calls[0][0];
		expect(callArgs).toContain("--model");
		expect(callArgs).toContain("opus");
		expect(callArgs[callArgs.length - 1]).toContain("I like pizza");
	});

	it("handles missing user message gracefully", async () => {
		await expect(
			runIndexerAgent({
				userMessage: "",
				assistantResponse: "Ok",
				mcpServerPath: "/path",
				emitSSE: vi.fn(),
			}),
		).resolves.toBeUndefined();

		expect(spawnCli).toHaveBeenCalledTimes(1);
	});
});
