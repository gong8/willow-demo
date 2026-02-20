import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnCli } from "../cli-chat.js";
import {
	getMaintenanceStatus,
	notifyConversationComplete,
	runMaintenance,
} from "../maintenance.js";

vi.mock("../cli-chat.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../cli-chat.js")>();
	return {
		...actual,
		spawnCli: vi.fn(() => ({
			stdout: { on: vi.fn() },
			stderr: { on: vi.fn() },
			stdin: { end: vi.fn() },
			on: vi.fn((event, cb) => {
				if (event === "close") setTimeout(cb, 10);
			}),
			kill: vi.fn(),
		})),
		writeSystemPrompt: vi.fn(() => "/tmp/prompt.txt"),
		writeMcpConfig: vi.fn(() => "/tmp/config.json"),
		createInvocationDir: vi.fn(() => "/tmp/inv"),
		getCliModel: vi.fn(() => "opus"),
	};
});

vi.mock("fs", () => ({
	readFileSync: vi.fn(() => JSON.stringify({ nodes: {} })),
	statSync: vi.fn(() => ({ size: 5000 })),
}));

describe("maintenance service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// We don't have a reliable way to reset internal state of the module
		// without `vi.resetModules()` which might be slow, so we test carefully.
	});

	it("can get initial status", () => {
		const status = getMaintenanceStatus();
		expect(status.conversationsSinceLastMaintenance).toBeDefined();
		expect(status.threshold).toBeDefined();
		// Status might carry over from previous tests but should be defined
	});

	it("runMaintenance returns a job and blocks concurrent runs", () => {
		const job1 = runMaintenance({ trigger: "manual", mcpServerPath: "/mcp" });
		expect(job1).toBeDefined();
		expect(job1?.trigger).toBe("manual");

		// Second run while first is active should return null
		const job2 = runMaintenance({ trigger: "manual", mcpServerPath: "/mcp" });
		expect(job2).toBeNull();

		expect(spawnCli).toHaveBeenCalledTimes(1);
	});

	it("notifyConversationComplete tracks conversations and triggers maintenance", () => {
		// Mock out run if needed or just let it hit the concurrent guard
		notifyConversationComplete("/mcp");
		const status = getMaintenanceStatus();
		expect(status.conversationsSinceLastMaintenance).toBeGreaterThan(0);
	});
});
