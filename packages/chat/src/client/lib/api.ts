import type { WillowGraph } from "./graph-types.js";

const BASE_URL = "/api";

async function fetchJson<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`);
	return res.json();
}

async function postJson<T>(
	path: string,
	body?: unknown,
	{ checkOk = false }: { checkOk?: boolean } = {},
): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: "POST",
		...(body !== undefined && {
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	});
	if (checkOk && !res.ok) {
		const err = await res.json();
		throw new Error(err.error || "Request failed");
	}
	return res.json();
}

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

export type MaintenanceToolCall = Omit<ToolCallData, "phase">;

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

// --- Chat API ---

export function fetchConversations(): Promise<Conversation[]> {
	return fetchJson("/chat/conversations");
}

export function createConversation(): Promise<Conversation> {
	return postJson("/chat/conversations");
}

export async function deleteConversation(id: string): Promise<void> {
	await fetch(`${BASE_URL}/chat/conversations/${id}`, { method: "DELETE" });
}

export function fetchMessages(conversationId: string): Promise<Message[]> {
	return fetchJson(`/chat/conversations/${conversationId}/messages`);
}

// --- Maintenance API ---

export function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
	return fetchJson("/chat/maintenance/status");
}

export function triggerMaintenance(): Promise<{ jobId: string }> {
	return postJson("/chat/maintenance/run");
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

// --- Resource API ---

export function fetchResources(): Promise<Resource[]> {
	return fetchJson("/resources");
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

export function createUrlResource(url: string): Promise<Resource> {
	return postJson("/resources/url", { url }, { checkOk: true });
}

export async function deleteResource(id: string): Promise<void> {
	await fetch(`${BASE_URL}/resources/${id}`, { method: "DELETE" });
}

export function fetchResourceContent(
	id: string,
): Promise<{ text: string | null }> {
	return fetchJson(`/resources/${id}/content`);
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

// --- VCS API ---

export interface GraphStatus {
	headHash: string | null;
	hasLocalChanges: boolean;
}

export function fetchGraphStatus(): Promise<GraphStatus> {
	return fetchJson("/graph/status");
}

export function fetchCommitLog(limit = 50): Promise<CommitEntry[]> {
	return fetchJson(`/graph/log?limit=${limit}`);
}

export function fetchCommitDetail(hash: string): Promise<CommitDetail> {
	return fetchJson(`/graph/commits/${hash}`);
}

export function fetchBranches(): Promise<BranchInfo[]> {
	return fetchJson("/graph/branches");
}

export function restoreToCommit(
	hash: string,
): Promise<{ ok: boolean; hash: string }> {
	return postJson("/graph/restore", { hash });
}

export function fetchGraphAtCommit(hash: string): Promise<WillowGraph> {
	return fetchJson(`/graph/at/${hash}`);
}

export function fetchLocalDiff(): Promise<ChangeSummary> {
	return fetchJson("/graph/status/diff");
}

export function diffCommits(
	from: string,
	to: string,
): Promise<ChangeSummary> {
	return fetchJson(`/graph/diff?from=${from}&to=${to}`);
}
