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

export interface IndexerStatus {
	active: boolean;
	status: "running" | "complete" | "error" | null;
	toolCalls: ToolCallData[];
}

export async function fetchIndexerStatus(
	conversationId: string,
): Promise<IndexerStatus> {
	const res = await fetch(
		`${BASE_URL}/chat/conversations/${conversationId}/indexer-status`,
	);
	return res.json();
}
