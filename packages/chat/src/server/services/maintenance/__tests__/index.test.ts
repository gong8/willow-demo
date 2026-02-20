import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../enrichment/enricher.js", () => ({
	runEnrichment: vi.fn(async (options: { onProgress?: (p: unknown) => void }) => {
		options.onProgress?.({
			phase: "done",
			phaseLabel: "Maintenance complete",
			crawlersTotal: 0,
			crawlersComplete: 0,
			totalFindings: 0,
			resolverActions: 0,
			phaseStartedAt: Date.now(),
		});
		return {
			preScanFindings: [],
			crawlerReports: [],
			resolverActions: 0,
			graphStats: { nodeCount: 5, linkCount: 2, categoryCount: 2 },
			durationMs: 100,
		};
	}),
}));

vi.mock("@willow/core", () => ({
	JsGraphStore: {
		open: vi.fn(() => ({
			currentBranch: vi.fn(() => "main"),
			vcsInit: vi.fn(),
			createBranch: vi.fn(),
			switchBranch: vi.fn(),
			deleteBranch: vi.fn(),
			hasPendingChanges: vi.fn(() => false),
			commitExternalChanges: vi.fn(() => null),
			discardChanges: vi.fn(),
			mergeBranch: vi.fn(() => "hash"),
		})),
	},
}));

import {
	getMaintenanceStatus,
	notifyConversationComplete,
	runMaintenance,
} from "../maintenance.js";

describe("maintenance service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("can get initial status", () => {
		const status = getMaintenanceStatus();
		expect(status.conversationsSinceLastMaintenance).toBeDefined();
		expect(status.threshold).toBeDefined();
	});

	it("runMaintenance returns a job and blocks concurrent runs", () => {
		const job1 = runMaintenance({ trigger: "manual", mcpServerPath: "/mcp" });
		expect(job1).toBeDefined();
		expect(job1?.trigger).toBe("manual");

		// Second run while first is active should return null
		const job2 = runMaintenance({ trigger: "manual", mcpServerPath: "/mcp" });
		expect(job2).toBeNull();
	});

	it("notifyConversationComplete tracks conversations", () => {
		notifyConversationComplete("/mcp");
		const status = getMaintenanceStatus();
		expect(status.conversationsSinceLastMaintenance).toBeGreaterThan(0);
	});
});
