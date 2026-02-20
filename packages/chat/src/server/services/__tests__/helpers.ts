import { vi } from "vitest";

/** Creates a mock child process with optional stdout text emission. */
export function createMockProc(textToEmit?: string) {
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

/** Standard mock return for cli-chat utilities used by indexer and crawler tests. */
export function mockCliChatUtils() {
	return {
		spawnCli: vi.fn(() => createMockProc()),
		writeMcpConfig: vi.fn(() => "/tmp/mcp-config.json"),
		writeSystemPrompt: vi.fn(() => "/tmp/system-prompt.txt"),
		createInvocationDir: vi.fn(() => "/tmp/invocation"),
		cleanupDir: vi.fn(),
		BLOCKED_BUILTIN_TOOLS: [],
		createStreamParser: vi.fn(() => ({ process: vi.fn() })),
		pipeStdout: vi.fn(),
		getCliModel: vi.fn(() => "sonnet"),
		LLM_MODEL: "test-model",
	};
}
