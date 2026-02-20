import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStream, startStream, subscribe } from "../stream-manager.js";

const mockDb = {
	message: {
		create: vi.fn(),
		findMany: vi.fn(() =>
			Promise.resolve([{ role: "user", content: "dummy" }]),
		),
	},
	conversation: { update: vi.fn() },
};

const encoder = new TextEncoder();

function sse(event: string, data: string) {
	return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
}

function controllableStream() {
	let controller!: ReadableStreamDefaultController;
	const readable = new ReadableStream({
		start(c) {
			controller = c;
		},
	});
	return {
		readable,
		send(event: string, data: string) {
			controller.enqueue(sse(event, data));
		},
		close() {
			controller.close();
		},
	};
}

describe("stream-manager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	function startControlled(id: string) {
		const ctrl = controllableStream();
		const stream = startStream(id, ctrl.readable, mockDb as any);
		return { ...ctrl, stream };
	}

	it("starts a stream and gets it by id", () => {
		const stream = startStream("conv-1", new ReadableStream(), mockDb as any);
		expect(stream.status).toBe("streaming");
		expect(getStream("conv-1")).toBe(stream);
	});

	it("re-returns existing stream if already streaming", () => {
		const stream1 = startStream("conv-2", new ReadableStream(), mockDb as any);
		const stream2 = startStream("conv-2", new ReadableStream(), mockDb as any);
		expect(stream1).toBe(stream2);
	});

	it("subscribes to a stream and receives events", async () => {
		const { send, close, stream } = startControlled("conv-3");
		const cb = vi.fn();
		const handle = subscribe("conv-3", cb);
		expect(handle).not.toBeNull();

		send("content", '{"content":"hello"}');
		send("done", "[DONE]");
		close();

		await stream.done;
		await new Promise((resolve) => process.nextTick(resolve));

		expect(cb).toHaveBeenCalledWith(
			"content",
			JSON.stringify({ content: "hello" }),
		);
		expect(cb).toHaveBeenCalledWith("title", expect.any(String));
		expect(cb).toHaveBeenCalledWith("done", "[DONE]");

		handle?.unsubscribe();
	});

	it("handles tool calls in stream parsing", async () => {
		const { send, close, stream } = startControlled("conv-tc");

		send("tool_call_start", '{"toolCallId":"t1","toolName":"search"}');
		send("tool_call_args", '{"toolCallId":"t1","args":{"q":"test"}}');
		send("content", '{"content":"some result text"}');
		send(
			"tool_result",
			'{"toolCallId":"t1","result":"found 1","isError":false}',
		);
		send("done", "[DONE]");
		close();

		await stream.done;

		expect(stream.toolCallsData).toHaveLength(1);
		expect(stream.toolCallsData[0]).toMatchObject({
			toolCallId: "t1",
			args: { q: "test" },
			result: "found 1",
		});
		expect(stream.fullContent).toBe("some result text");
	});

	it("returns null for subscription to non-existent stream", () => {
		expect(subscribe("nonexistent", vi.fn())).toBeNull();
	});

	it("cleans up stream after completion delay", async () => {
		const { send, close, stream } = startControlled("conv-cleanup");

		send("done", "[DONE]");
		close();
		await stream.done;

		expect(getStream("conv-cleanup")).toBeDefined();
		vi.advanceTimersByTime(61000);
		expect(getStream("conv-cleanup")).toBeUndefined();
	});
});
