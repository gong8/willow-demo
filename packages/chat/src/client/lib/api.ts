import type { WillowGraph } from "./graph-types.js";

const BASE_URL = "/api";

export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
}

export interface ChatAttachment {
	id: string;
	filename: string;
	contentType: string;
}

export interface Message {
	id: string;
	role: string;
	content: string;
	toolCalls: string | null;
	createdAt: string;
	attachments?: ChatAttachment[];
}

export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	phase?: "search" | "chat" | "indexer";
}

export async function fetchConversations(): Promise<Conversation[]> {
	const res = await fetch(`${BASE_URL}/chat/conversations`);
	return res.json();
}

export async function createConversation(): Promise<Conversation> {
	const res = await fetch(`${BASE_URL}/chat/conversations`, { method: "POST" });
	return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
	await fetch(`${BASE_URL}/chat/conversations/${id}`, { method: "DELETE" });
}

export async function fetchMessages(
	conversationId: string,
): Promise<Message[]> {
	const res = await fetch(
		`${BASE_URL}/chat/conversations/${conversationId}/messages`,
	);
	return res.json();
}

export interface MaintenanceToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

export interface MaintenanceProgress {
	phase: "pre-scan" | "crawling" | "resolving" | "committing" | "done";
	phaseLabel: string;
	crawlersTotal: number;
	crawlersComplete: number;
	totalFindings: number;
	resolverActions: number;
	phaseStartedAt: number;
}

export interface MaintenanceJob {
	id: string;
	status: "running" | "complete" | "error";
	trigger: "manual" | "auto";
	toolCalls: MaintenanceToolCall[];
	progress: MaintenanceProgress | null;
	startedAt: string;
	completedAt?: string;
}

export interface MaintenanceStatus {
	currentJob: MaintenanceJob | null;
	conversationsSinceLastMaintenance: number;
	threshold: number;
}

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
	const res = await fetch(`${BASE_URL}/chat/maintenance/status`);
	return res.json();
}

export async function triggerMaintenance(): Promise<{ jobId: string }> {
	const res = await fetch(`${BASE_URL}/chat/maintenance/run`, {
		method: "POST",
	});
	return res.json();
}

// --- Resource types ---

export interface Resource {
	id: string;
	name: string;
	resourceType: "pdf" | "text" | "markdown" | "url";
	status: "pending" | "extracting" | "ready" | "indexing" | "indexed" | "error";
	sourceUrl: string | null;
	contentType: string | null;
	fileSize: number | null;
	errorMessage?: string | null;
	indexContext?: string | null;
	createdAt: string;
	updatedAt: string;
}

export async function fetchResources(): Promise<Resource[]> {
	const res = await fetch(`${BASE_URL}/resources`);
	return res.json();
}

export async function uploadResource(file: File): Promise<Resource> {
	const formData = new FormData();
	formData.append("file", file);
	const res = await fetch(`${BASE_URL}/resources`, {
		method: "POST",
		body: formData,
	});
	if (!res.ok) {
		const err = await res.json();
		throw new Error(err.error || "Upload failed");
	}
	return res.json();
}

export async function createUrlResource(url: string): Promise<Resource> {
	const res = await fetch(`${BASE_URL}/resources/url`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url }),
	});
	if (!res.ok) {
		const err = await res.json();
		throw new Error(err.error || "URL fetch failed");
	}
	return res.json();
}

export async function deleteResource(id: string): Promise<void> {
	await fetch(`${BASE_URL}/resources/${id}`, { method: "DELETE" });
}

export async function fetchResourceContent(
	id: string,
): Promise<{ text: string | null }> {
	const res = await fetch(`${BASE_URL}/resources/${id}/content`);
	return res.json();
}

export async function indexResourceStream(
	id: string,
	context?: string,
	onEvent?: (event: string, data: string) => void,
): Promise<void> {
	const res = await fetch(`${BASE_URL}/resources/${id}/index`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ context }),
	});

	if (!res.ok) {
		const err = await res.json();
		throw new Error(err.error || "Indexing failed");
	}

	const reader = res.body?.getReader();
	if (!reader) return;

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		let currentEvent = "message";
		for (const line of lines) {
			if (line.startsWith("event: ")) {
				currentEvent = line.slice(7);
			} else if (line.startsWith("data: ")) {
				const data = line.slice(6);
				onEvent?.(currentEvent, data);
				if (currentEvent === "done") return;
			}
		}
	}
}

// --- VCS types ---

export interface CommitEntry {
	hash: string;
	message: string;
	timestamp: string;
	source: string;
	sourceDetail?: string;
	parents: string[];
	storageType: string;
}

export interface NodeChangeSummary {
	nodeId: string;
	nodeType: string;
	content: string;
	oldContent?: string;
	path: string[];
}

export interface LinkChangeSummary {
	linkId: string;
	fromNode: string;
	toNode: string;
	relation: string;
	bidirectional: boolean;
	confidence: string | null;
}

export interface ChangeSummary {
	nodesCreated: NodeChangeSummary[];
	nodesUpdated: NodeChangeSummary[];
	nodesDeleted: NodeChangeSummary[];
	linksCreated: LinkChangeSummary[];
	linksRemoved: LinkChangeSummary[];
	linksUpdated: LinkChangeSummary[];
}

export interface CommitDetail {
	commit: CommitEntry;
	diff: ChangeSummary;
}

export interface BranchInfo {
	name: string;
	head: string;
	isCurrent: boolean;
}

// --- VCS API functions ---

export interface GraphStatus {
	headHash: string | null;
	hasLocalChanges: boolean;
}

export async function fetchGraphStatus(): Promise<GraphStatus> {
	const res = await fetch(`${BASE_URL}/graph/status`);
	return res.json();
}

export async function fetchCommitLog(limit = 50): Promise<CommitEntry[]> {
	const res = await fetch(`${BASE_URL}/graph/log?limit=${limit}`);
	return res.json();
}

export async function fetchCommitDetail(hash: string): Promise<CommitDetail> {
	const res = await fetch(`${BASE_URL}/graph/commits/${hash}`);
	return res.json();
}

export async function fetchBranches(): Promise<BranchInfo[]> {
	const res = await fetch(`${BASE_URL}/graph/branches`);
	return res.json();
}

export async function restoreToCommit(
	hash: string,
): Promise<{ ok: boolean; hash: string }> {
	const res = await fetch(`${BASE_URL}/graph/restore`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ hash }),
	});
	return res.json();
}

export async function fetchGraphAtCommit(hash: string): Promise<WillowGraph> {
	const res = await fetch(`${BASE_URL}/graph/at/${hash}`);
	return res.json();
}

export async function fetchLocalDiff(): Promise<ChangeSummary> {
	const res = await fetch(`${BASE_URL}/graph/status/diff`);
	return res.json();
}

export async function diffCommits(
	from: string,
	to: string,
): Promise<ChangeSummary> {
	const res = await fetch(`${BASE_URL}/graph/diff?from=${from}&to=${to}`);
	return res.json();
}
