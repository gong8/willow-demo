import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStream, startStream, subscribe } from "../stream-manager.js";

// Mock ActiveStreams map implicitly through the exported functions
const mockDb = {
	message: {
		create: vi.fn(),
		findMany: vi.fn(() =>
			Promise.resolve([{ role: "user", content: "dummy" }]),
		),
	},
	conversation: { update: vi.fn() },
};

describe("stream-manager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	it("starts a stream and gets it by id", () => {
		const mockReadable = new ReadableStream();
		const stream = startStream("conv-1", mockReadable, mockDb as any);
		expect(stream).toBeDefined();
		expect(stream.status).toBe("streaming");
		expect(getStream("conv-1")).toBe(stream);
	});

	it("re-returns existing stream if already streaming", () => {
		const mockReadable1 = new ReadableStream();
		const mockReadable2 = new ReadableStream();
		const stream1 = startStream("conv-2", mockReadable1, mockDb as any);
		const stream2 = startStream("conv-2", mockReadable2, mockDb as any);
		expect(stream1).toBe(stream2);
	});

	it("subscribes to a stream and receives events", async () => {
		// Create a readable stream that will push some mocked SSE
		let controller: ReadableStreamDefaultController;
		const mockReadable = new ReadableStream({
			start(c) {
				controller = c;
			},
		});

		const stream = startStream("conv-3", mockReadable, mockDb as any);
		const cb = vi.fn();
		const handle = subscribe("conv-3", cb);
		expect(handle).not.toBeNull();

		// Simulate reading real SSE
		const encoder = new TextEncoder();
		controller!.enqueue(
			encoder.encode('event: content\ndata: {"content":"hello"}\n\n'),
		);
		controller!.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"));
		controller!.close();

		await stream.done;

		// Wait for microtasks
		await new Promise((resolve) => process.nextTick(resolve));

		// It should receive content and done
		expect(cb).toHaveBeenCalledWith(
			"content",
			JSON.stringify({ content: "hello" }),
		);
		expect(cb).toHaveBeenCalledWith("title", expect.any(String)); // called because it's complete
		expect(cb).toHaveBeenCalledWith("done", "[DONE]");

		handle?.unsubscribe();
	});

	it("handles tool calls in stream parsing", async () => {
		let controller: ReadableStreamDefaultController;
		const mockReadable = new ReadableStream({
			start(c) {
				controller = c;
			},
		});
		const encoder = new TextEncoder();
		const stream = startStream("conv-tc", mockReadable, mockDb as any);

		controller!.enqueue(
			encoder.encode(
				'event: tool_call_start\ndata: {"toolCallId":"t1","toolName":"search"}\n\n',
			),
		);
		controller!.enqueue(
			encoder.encode(
				'event: tool_call_args\ndata: {"toolCallId":"t1","args":{"q":"test"}}\n\n',
			),
		);
		controller!.enqueue(
			encoder.encode(
				'event: content\ndata: {"content":"some result text"}\n\n',
			),
		);
		controller!.enqueue(
			encoder.encode(
				'event: tool_result\ndata: {"toolCallId":"t1","result":"found 1","isError":false}\n\n',
			),
		);
		controller!.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"));
		controller!.close();

		await stream.done;

		expect(stream.toolCallsData).toHaveLength(1);
		expect(stream.toolCallsData[0].toolCallId).toBe("t1");
		expect(stream.toolCallsData[0].args).toEqual({ q: "test" });
		expect(stream.toolCallsData[0].result).toBe("found 1");
		expect(stream.fullContent).toBe("some result text");
	});

	it("returns null for subscription to non-existent stream", () => {
		const handle = subscribe("nonexistent", vi.fn());
		expect(handle).toBeNull();
	});

	it("cleans up stream after completion delay", async () => {
		let controller: ReadableStreamDefaultController;
		const mockReadable = new ReadableStream({
			start(c) {
				controller = c;
			},
		});
		const stream = startStream("conv-cleanup", mockReadable, mockDb as any);

		controller!.enqueue(
			new TextEncoder().encode("event: done\ndata: [DONE]\n\n"),
		);
		controller!.close();

		await stream.done;

		expect(getStream("conv-cleanup")).toBeDefined();
		vi.advanceTimersByTime(61000); // CLEANUP_DELAY_MS is 60_000
		expect(getStream("conv-cleanup")).toBeUndefined();
	});
});
