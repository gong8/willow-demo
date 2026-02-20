import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventSocket } from "../event-socket.js";

const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function sendToSocket(socketPath: string, payload: string) {
	return new Promise<void>((resolve) => {
		const client = connect(socketPath);
		client.on("connect", () => {
			client.write(payload);
			client.end();
			resolve();
		});
	});
}

describe("event-socket", () => {
	let sockets: ReturnType<typeof createEventSocket>[] = [];

	afterEach(() => {
		for (const socket of sockets) socket.cleanup();
		sockets = [];
	});

	function setup() {
		const socket = createEventSocket();
		sockets.push(socket);
		const received: { event: string; data: string }[] = [];
		socket.onEvent((event, data) => received.push({ event, data }));
		return { socket, received };
	}

	it("creates a unix socket and cleans it up", () => {
		const socket = createEventSocket();
		sockets.push(socket);
		expect(socket.socketPath).toContain("willow-evt-");
		expect(typeof socket.cleanup).toBe("function");
		expect(typeof socket.onEvent).toBe("function");
	});

	it("receives events submitted via the socket stream", async () => {
		const { socket, received } = setup();
		await wait();
		await sendToSocket(
			socket.socketPath,
			`${JSON.stringify({ event: "test_event", data: "test_data" })}\n`,
		);
		await wait();
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({ event: "test_event", data: "test_data" });
	});

	it("ignores invalid JSON chunks over socket", async () => {
		const { socket, received } = setup();
		await wait();
		await sendToSocket(socket.socketPath, "invalid json line\n");
		await wait();
		expect(received).toHaveLength(0);
	});
});
