import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgenticStream } from "../agentic-stream.js";
import { runChatAgent } from "../cli-chat.js";
import { createEventSocket } from "../event-socket.js";
import { runIndexerAgent } from "../indexer.js";

vi.mock("../cli-chat.js", () => ({
	runChatAgent: vi.fn(),
}));

vi.mock("../indexer.js", () => ({
	runIndexerAgent: vi.fn(),
}));

vi.mock("../event-socket.js", () => ({
	createEventSocket: vi.fn(() => ({
		socketPath: "/tmp/sock",
		onEvent: vi.fn(),
		cleanup: vi.fn(),
	})),
}));

describe("agentic-stream", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a readable stream and runs agents", async () => {
		let interceptEmit: any;
		vi.mocked(runChatAgent).mockImplementation(async (opts, emit) => {
			interceptEmit = emit;
			// simulate content
			emit("content", JSON.stringify({ content: "Hello" }));
			emit("content", JSON.stringify({ content: " world" }));
		});

		const stream = createAgenticStream({
			chatOptions: { messages: [], systemPrompt: "", mcpServerPath: "/mcp" },
			userMessage: "Hi",
			mcpServerPath: "/mcp",
		});

		const reader = stream.getReader();
		const decoder = new TextDecoder();

		let result = await reader.read();
		expect(decoder.decode(result.value)).toContain("event: content");

		// consume the rest
		while (!result.done) {
			result = await reader.read();
		}

		expect(runChatAgent).toHaveBeenCalledTimes(1);
		expect(runIndexerAgent).toHaveBeenCalledTimes(1);

		const indexerArgs = vi.mocked(runIndexerAgent).mock.calls[0][0];
		expect(indexerArgs.userMessage).toBe("Hi");
		expect(indexerArgs.assistantResponse).toBe("Hello world");
	});
});
