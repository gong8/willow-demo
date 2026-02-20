import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { type Server, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logger.js";
import { LineBuffer } from "./line-buffer.js";

const log = createLogger("event-socket");

type EventCallback = (event: string, data: string) => void;

export interface EventSocket {
	socketPath: string;
	onEvent(cb: EventCallback): void;
	cleanup(): void;
}

/**
 * Creates a Unix domain socket server that receives newline-delimited JSON
 * events from child processes (e.g. the coordinator MCP server).
 *
 * Each message is expected to be `{ "event": "...", "data": "..." }`.
 */
export function createEventSocket(): EventSocket {
	const socketPath = join(
		tmpdir(),
		`willow-evt-${randomUUID().slice(0, 12)}.sock`,
	);

	log.debug("Socket created", { path: socketPath });
	const callbacks: EventCallback[] = [];

	const server: Server = createServer((conn) => {
		log.debug("Client connected");
		const lineBuffer = new LineBuffer();
		conn.on("data", (chunk: Buffer) => {
			for (const line of lineBuffer.push(chunk.toString())) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const msg = JSON.parse(trimmed) as {
						event: string;
						data: string;
					};
					for (const cb of callbacks) {
						cb(msg.event, msg.data);
					}
				} catch {
					log.debug("Message parse error");
				}
			}
		});
	});

	server.listen(socketPath);
	log.debug("Socket listening", { path: socketPath });

	return {
		socketPath,
		onEvent(cb: EventCallback) {
			callbacks.push(cb);
		},
		cleanup() {
			log.debug("Socket cleanup", { path: socketPath });
			server.close();
			try {
				unlinkSync(socketPath);
			} catch {
				log.warn("Socket unlink failed");
			}
		},
	};
}
