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

export interface MaintenanceJob {
	id: string;
	status: "running" | "complete" | "error";
	trigger: "manual" | "auto";
	toolCalls: MaintenanceToolCall[];
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
