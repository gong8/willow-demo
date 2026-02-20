import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { JsGraphStore } from "@willow/core";
import { createLogger } from "../../logger.js";
import type { ToolCallData } from "../cli-chat.js";
import { runMaintenancePipeline } from "./pipeline.js";
import type { MaintenanceProgress, MaintenanceReport } from "./types.js";

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

function cleanupBranch(
	graphPath: string,
	branchName: string,
	originalBranch: string | null,
	mode: "merge" | "discard",
): void {
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
		/* best effort cleanup */
	}
}

function completeJob(
	job: MaintenanceJob,
	result: { report: MaintenanceReport } | { error: Error },
	graphPath: string,
	branchName: string,
	originalBranch: string | null,
): void {
	job.completedAt = new Date();

	if ("error" in result) {
		job.status = "error";
		log.error("Job failed", { id: job.id, error: result.error.message });
		cleanupBranch(graphPath, branchName, originalBranch, "discard");
		return;
	}

	const { report } = result;
	job.status = "complete";
	log.info("Job complete", {
		id: job.id,
		preScanFindings: report.preScanFindings.length,
		crawlerReports: report.crawlerReports.length,
		resolverActions: report.resolverActions,
		durationMs: report.durationMs,
	});
	conversationsSinceLastMaintenance = 0;

	const store = tryOpen(graphPath);
	if (store) {
		try {
			const commitResult = store.commitExternalChanges({
				message: `Maintenance: ${job.trigger} (${report.resolverActions} actions)`,
				source: "maintenance",
				jobId: job.id,
				conversationId: undefined,
				summary: undefined,
				toolName: undefined,
			});
			if (commitResult) {
				log.info("Committed maintenance changes", { hash: commitResult });
			}
		} catch {
			log.warn("VCS commit failed after maintenance");
		}
	}

	cleanupBranch(graphPath, branchName, originalBranch, "merge");
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
	let originalBranch: string | null = null;
	try {
		const store = JsGraphStore.open(graphPath);
		ensureVcsInit(store);
		originalBranch = store.currentBranch();
		store.createBranch(branchName);
		store.switchBranch(branchName);
	} catch {
		// If branching fails, fall through — pipeline will still commit on whatever branch
	}

	runMaintenancePipeline({
		mcpServerPath: options.mcpServerPath,
		trigger: options.trigger,
		onProgress: (progress) => {
			job.progress = progress;
		},
	})
		.then((report) =>
			completeJob(job, { report }, graphPath, branchName, originalBranch),
		)
		.catch((e) =>
			completeJob(
				job,
				{ error: e as Error },
				graphPath,
				branchName,
				originalBranch,
			),
		);

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
