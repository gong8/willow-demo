import { connect } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventSocket } from "../event-socket.js";

describe("event-socket", () => {
	let sockets: ReturnType<typeof createEventSocket>[] = [];

	afterEach(() => {
		for (const socket of sockets) {
			socket.cleanup();
		}
		sockets = [];
	});

	it("creates a unix socket and cleans it up", () => {
		const socket = createEventSocket();
		sockets.push(socket);

		expect(socket.socketPath).toContain("willow-evt-");
		expect(typeof socket.cleanup).toBe("function");
		expect(typeof socket.onEvent).toBe("function");
	});

	it("receives events submitted via the socket stream", async () => {
		const socket = createEventSocket();
		sockets.push(socket);

		const received: { event: string; data: string }[] = [];
		socket.onEvent((event, data) => received.push({ event, data }));

		// wait a tiny bit for the server to listen
		await new Promise((resolve) => setTimeout(resolve, 50));

		const client = connect(socket.socketPath);

		await new Promise<void>((resolve) => {
			client.on("connect", () => {
				// write JSON line
				client.write(
					JSON.stringify({ event: "test_event", data: "test_data" }) + "\n",
				);
				client.end();
				resolve();
			});
		});

		// wait for parsing
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(received).toHaveLength(1);
		expect(received[0].event).toBe("test_event");
		expect(received[0].data).toBe("test_data");
	});

	it("ignores invalid JSON chunks over socket", async () => {
		const socket = createEventSocket();
		sockets.push(socket);

		const received: { event: string; data: string }[] = [];
		socket.onEvent((event, data) => received.push({ event, data }));

		await new Promise((resolve) => setTimeout(resolve, 50));
		const client = connect(socket.socketPath);

		await new Promise<void>((resolve) => {
			client.on("connect", () => {
				client.write("invalid json line\n");
				client.end();
				resolve();
			});
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(received).toHaveLength(0);
	});
});
