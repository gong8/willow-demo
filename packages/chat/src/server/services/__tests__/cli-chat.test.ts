import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInvocationDir,
	createStreamParser,
	getCliModel,
	writeSystemPrompt,
	writeTempFile,
} from "../cli-chat.js";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const mkdirSyncMock = vi.fn();
	const writeFileSyncMock = vi.fn();
	const rmSyncMock = vi.fn();
	return {
		...actual,
		default: {
			...actual,
			mkdirSync: mkdirSyncMock,
			writeFileSync: writeFileSyncMock,
			rmSync: rmSyncMock,
		},
		mkdirSync: mkdirSyncMock,
		writeFileSync: writeFileSyncMock,
		rmSync: rmSyncMock,
	};
});

describe("cli-chat utilities", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("getCliModel returns correct models", () => {
		expect(getCliModel("claude-opus-4-6")).toBe("opus");
		expect(getCliModel("claude-haiku")).toBe("haiku");
		expect(getCliModel("gpt-4")).toBe("sonnet"); // fallback
	});

	it("createInvocationDir works", () => {
		const dir = createInvocationDir();
		expect(dir).toContain("willow-cli");
		expect(mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
	});

	it("writeTempFile writes to file", () => {
		const filepath = writeTempFile("/tmp/dir", "test.txt", "content");
		expect(filepath).toBe("/tmp/dir/test.txt");
		expect(writeFileSync).toHaveBeenCalledWith("/tmp/dir/test.txt", "content");
	});

	it("writeSystemPrompt appends constraints", () => {
		writeSystemPrompt("/tmp/dir", "Custom prompt");
		expect(writeFileSync).toHaveBeenCalledWith(
			"/tmp/dir/system-prompt.txt",
			expect.stringContaining("Custom prompt"),
		);
		expect(writeFileSync).toHaveBeenCalledWith(
			"/tmp/dir/system-prompt.txt",
			expect.stringContaining("IMPORTANT CONSTRAINTS:"),
		);
	});
});

describe("cli-chat stream parser", () => {
	function streamEvent(event: Record<string, unknown>) {
		return { type: "stream_event", event };
	}

	it("parses stream events correctly", () => {
		const emit = vi.fn();
		const parser = createStreamParser(emit);

		// Text content block
		parser.process(
			streamEvent({
				type: "content_block_start",
				index: 0,
				content_block: { type: "text" },
			}),
		);
		parser.process(
			streamEvent({
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Hello" },
			}),
		);
		parser.process(streamEvent({ type: "content_block_stop", index: 0 }));

		expect(emit).toHaveBeenCalledWith(
			"content",
			JSON.stringify({ content: "Hello" }),
		);

		// Tool use block
		parser.process(
			streamEvent({
				type: "content_block_start",
				index: 1,
				content_block: { type: "tool_use", id: "t1", name: "search" },
			}),
		);
		parser.process(
			streamEvent({
				type: "content_block_delta",
				index: 1,
				delta: { type: "input_json_delta", partial_json: '{"q"' },
			}),
		);
		parser.process(
			streamEvent({
				type: "content_block_delta",
				index: 1,
				delta: { type: "input_json_delta", partial_json: ':"test"}' },
			}),
		);
		parser.process(streamEvent({ type: "content_block_stop", index: 1 }));

		expect(emit).toHaveBeenCalledWith(
			"tool_call_start",
			JSON.stringify({ toolCallId: "t1", toolName: "search" }),
		);
		expect(emit).toHaveBeenCalledWith(
			"tool_call_args",
			JSON.stringify({
				toolCallId: "t1",
				toolName: "search",
				args: { q: "test" },
			}),
		);
	});
});
