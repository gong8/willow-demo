import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { createLogger } from "../../logger";
import type { ToolCallData } from "../cli-chat";
import { runMaintenancePipeline } from "./pipeline";
import type { MaintenanceProgress, MaintenanceReport } from "./types";

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

function getGraphPath(): string {
	return (
		process.env.WILLOW_GRAPH_PATH ?? resolve(homedir(), ".willow", "graph.json")
	);
}

function tryOpen(graphPath: string): InstanceType<typeof JsGraphStore> | null {
	try {
		return JsGraphStore.open(graphPath);
	} catch {
		return null;
	}
}

function ensureVcsInit(store: InstanceType<typeof JsGraphStore>): void {
	try {
		store.currentBranch();
	} catch {
		try {
			store.vcsInit();
		} catch {
			/* already initialized */
		}
	}
}

/** Set up a VCS branch for maintenance, returning cleanup helpers. */
function setupBranch(graphPath: string, branchName: string) {
	let originalBranch: string | null = null;

	try {
		const store = JsGraphStore.open(graphPath);
		ensureVcsInit(store);
		originalBranch = store.currentBranch();
		store.createBranch(branchName);
		store.switchBranch(branchName);
	} catch {
		// If branching fails, pipeline will still commit on whatever branch
	}

	return {
		/** Switch back to original branch and merge or discard. */
		cleanup(mode: "merge" | "discard") {
			if (!originalBranch) return;
			const store = tryOpen(graphPath);
			if (!store) return;

			if (store.currentBranch() === branchName) {
				if (mode === "discard") store.discardChanges();
				store.switchBranch(originalBranch);
			}
			if (mode === "merge") {
				try {
					store.mergeBranch(branchName);
				} catch {
					/* merge conflict — changes stay on maintenance branch */
				}
			}
			try {
				store.deleteBranch(branchName);
			} catch {
				/* best effort */
			}
		},
	};
}

function commitChanges(
	graphPath: string,
	job: MaintenanceJob,
	report: MaintenanceReport,
): void {
	const store = tryOpen(graphPath);
	if (!store) return;

	try {
		const hash = store.commitExternalChanges({
			message: `Maintenance: ${job.trigger} (${report.resolverActions} actions)`,
			source: "maintenance",
			jobId: job.id,
			conversationId: undefined,
			summary: undefined,
			toolName: undefined,
		});
		if (hash) {
			log.info("Committed maintenance changes", { hash });
		}
	} catch {
		log.warn("VCS commit failed after maintenance");
	}
}

export function runMaintenance(options: {
	trigger: "manual" | "auto";
	mcpServerPath: string;
}): MaintenanceJob | null {
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

	const graphPath = getGraphPath();
	const branchName = `maintenance/${job.id.slice(0, 8)}`;
	const branch = setupBranch(graphPath, branchName);

	runMaintenancePipeline({
		mcpServerPath: options.mcpServerPath,
		trigger: options.trigger,
		onProgress: (progress) => {
			job.progress = progress;
		},
	})
		.then((report) => {
			job.status = "complete";
			log.info("Job complete", {
				id: job.id,
				preScanFindings: report.preScanFindings.length,
				crawlerReports: report.crawlerReports.length,
				resolverActions: report.resolverActions,
				durationMs: report.durationMs,
			});
			conversationsSinceLastMaintenance = 0;
			commitChanges(graphPath, job, report);
			branch.cleanup("merge");
		})
		.catch((e) => {
			job.status = "error";
			log.error("Job failed", { id: job.id, error: (e as Error).message });
			branch.cleanup("discard");
		})
		.finally(() => {
			job.completedAt = new Date();
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
