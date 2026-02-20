import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { createLogger } from "../logger.js";
import type { ToolCallData } from "./cli-chat.js";
import { runEnrichment } from "./enrichment/enricher.js";
import type { MaintenanceProgress } from "./enrichment/types.js";

const log = createLogger("maintenance");

const MAINTENANCE_THRESHOLD = process.env.MAINTENANCE_THRESHOLD
	? Number.parseInt(process.env.MAINTENANCE_THRESHOLD, 10)
	: 5;

export interface MaintenanceJob {
	id: string;
	status: "running" | "complete" | "error";
	trigger: "manual" | "auto";
	toolCalls: ToolCallData[];
	progress: MaintenanceProgress | null;
	startedAt: Date;
	completedAt?: Date;
}

export interface MaintenanceStatus {
	currentJob: MaintenanceJob | null;
	conversationsSinceLastMaintenance: number;
	threshold: number;
}

let currentJob: MaintenanceJob | null = null;
let conversationsSinceLastMaintenance = 0;

export function runMaintenance(options: {
	trigger: "manual" | "auto";
	mcpServerPath: string;
}): MaintenanceJob | null {
	// Guard against concurrent runs
	if (currentJob?.status === "running") {
		return null;
	}

	const job: MaintenanceJob = {
		id: randomUUID(),
		status: "running",
		trigger: options.trigger,
		toolCalls: [],
		progress: null,
		startedAt: new Date(),
	};
	currentJob = job;
	log.info("Job started", { id: job.id, trigger: options.trigger });

	const graphPath =
		process.env.WILLOW_GRAPH_PATH ??
		resolve(homedir(), ".willow", "graph.json");

	// Create a maintenance branch so changes are isolated
	const branchName = `maintenance/${job.id.slice(0, 8)}`;
	let originalBranch: string | null = null;
	try {
		const store = JsGraphStore.open(graphPath);
		try {
			store.currentBranch();
		} catch {
			try {
				store.vcsInit();
			} catch {
				/* already initialized */
			}
		}
		originalBranch = store.currentBranch();
		store.createBranch(branchName);
		store.switchBranch(branchName);
	} catch {
		// If branching fails, fall through — enricher will still commit on whatever branch
	}

	// Run the multi-agent enrichment pipeline
	runEnrichment({
		mcpServerPath: options.mcpServerPath,
		trigger: options.trigger,
		onProgress: (progress) => {
			job.progress = progress;
		},
	})
		.then((report) => {
			job.status = "complete";
			job.completedAt = new Date();
			log.info("Job complete", {
				id: job.id,
				preScanFindings: report.preScanFindings.length,
				crawlerReports: report.crawlerReports.length,
				resolverActions: report.resolverActions,
				durationMs: report.durationMs,
			});
			conversationsSinceLastMaintenance = 0;

			// Commit on maintenance branch, switch back, merge
			try {
				const store = JsGraphStore.open(graphPath);

				const commitResult = store.commitExternalChanges({
					message: `Maintenance: ${job.trigger} enrichment (${report.resolverActions} actions)`,
					source: "maintenance",
					jobId: job.id,
					conversationId: undefined,
					summary: undefined,
					toolName: undefined,
				});

				if (commitResult) {
					log.info("Committed enrichment changes", { hash: commitResult });
				}

				// Merge maintenance branch back and clean up
				if (originalBranch && store.currentBranch() === branchName) {
					store.switchBranch(originalBranch);
					try {
						store.mergeBranch(branchName);
					} catch {
						// Merge conflict — changes stay on the maintenance branch
					}
					try {
						store.deleteBranch(branchName);
					} catch {
						/* best effort cleanup */
					}
				}
			} catch {
				log.warn("VCS commit failed after maintenance");
			}
		})
		.catch((e) => {
			job.status = "error";
			job.completedAt = new Date();
			log.error("Job failed", { id: job.id, error: (e as Error).message });

			// Discard maintenance branch on error
			if (originalBranch) {
				try {
					const store = JsGraphStore.open(graphPath);
					if (store.currentBranch() === branchName) {
						store.discardChanges();
						store.switchBranch(originalBranch);
					}
					store.deleteBranch(branchName);
				} catch {
					/* best effort */
				}
			}
		});

	return job;
}

export function notifyConversationComplete(mcpServerPath: string): void {
	conversationsSinceLastMaintenance++;
	log.debug("Conversation count incremented", {
		count: conversationsSinceLastMaintenance,
	});

	if (
		conversationsSinceLastMaintenance >= MAINTENANCE_THRESHOLD &&
		currentJob?.status !== "running"
	) {
		log.info("Auto-maintenance threshold reached", {
			count: conversationsSinceLastMaintenance,
		});
		// Delay to let the indexer finish first
		setTimeout(() => {
			runMaintenance({ trigger: "auto", mcpServerPath });
		}, 15_000);
	}
}

export function getMaintenanceStatus(): MaintenanceStatus {
	return {
		currentJob,
		conversationsSinceLastMaintenance,
		threshold: MAINTENANCE_THRESHOLD,
	};
}
