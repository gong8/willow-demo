import type { ThreadHistoryAdapter } from "@assistant-ui/react";
import type { QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { type ToolCallData, fetchMessages } from "../lib/api.js";
import type {
	IndexerResultsPart,
	SearchResultsPart,
} from "../lib/chat-adapter.js";

type ContentPart =
	| { type: "text"; text: string }
	| { type: "image"; image: string }
	| {
			type: "tool-call";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			argsText: string;
			result?: string;
			isError?: boolean;
	  };

function toToolCallPart(tc: ToolCallData): ContentPart {
	return {
		type: "tool-call",
		toolCallId: tc.toolCallId,
		toolName: tc.toolName,
		args: tc.args,
		argsText: JSON.stringify(tc.args),
		result: tc.result,
		isError: tc.isError,
	};
}

function parseXmlToolCalls(
	content: string,
	messageIndex: number,
): ContentPart[] {
	const calls = [
		...content.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g),
	].flatMap((m) => {
		try {
			const parsed = JSON.parse(m[1]);
			return [{ name: parsed.name, args: parsed.arguments || {} }];
		} catch {
			return [];
		}
	});

	const results = [
		...content.matchAll(/<tool_result>\s*([\s\S]*?)\s*<\/tool_result>/g),
	].map((m) => m[1].trim());

	return calls.map((call, j) => ({
		type: "tool-call" as const,
		toolCallId: `hist_tc_${messageIndex}_${j}`,
		toolName: call.name,
		args: call.args,
		argsText: JSON.stringify(call.args),
		result: results[j],
		isError: false,
	}));
}

function stripXmlToolTags(content: string) {
	return content
		.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
		.replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function buildContentParts(
	m: {
		content: string;
		toolCalls: string | null;
		attachments?: { id: string }[];
	},
	index: number,
) {
	const parts: ContentPart[] = [];
	const customMeta: Record<string, unknown> = {};

	for (const att of m.attachments ?? []) {
		parts.push({ type: "image", image: `/api/chat/attachments/${att.id}` });
	}

	if (m.toolCalls) {
		try {
			const toolCalls: ToolCallData[] = JSON.parse(m.toolCalls);
			const searchCalls = toolCalls.filter((tc) => tc.phase === "search");
			const indexerCalls = toolCalls.filter((tc) => tc.phase === "indexer");

			for (const tc of toolCalls) {
				if (tc.phase !== "search" && tc.phase !== "indexer") {
					parts.push(toToolCallPart(tc));
				}
			}

			if (searchCalls.length > 0) {
				customMeta.searchResults = {
					type: "search-results",
					searchStatus: "done",
					toolCalls: searchCalls.map(
						({ toolCallId, toolName, args, result, isError }) => ({
							toolCallId,
							toolName,
							args,
							result,
							isError,
						}),
					),
				} satisfies SearchResultsPart;
			}

			if (indexerCalls.length > 0) {
				customMeta.indexerResults = {
					type: "indexer-results",
					indexerStatus: "done",
					toolCalls: indexerCalls.map(
						({ toolCallId, toolName, args, result, isError }) => ({
							toolCallId,
							toolName,
							args,
							result,
							isError,
						}),
					),
				} satisfies IndexerResultsPart;
			}
		} catch {
			// Invalid tool calls JSON, skip
		}
	}

	parts.push(...parseXmlToolCalls(m.content, index));
	parts.push({ type: "text", text: stripXmlToolTags(m.content) });

	return { parts, customMeta };
}

export function useChatHistory(
	conversationId: string,
	queryClient: QueryClient,
) {
	return useMemo(
		() =>
			({
				async load() {
					const messages = await fetchMessages(conversationId);

					const repoMessages = messages.map((m, i) => {
						const { parts, customMeta } = buildContentParts(m, i);
						return {
							message: {
								id: m.id,
								role: m.role,
								content: parts,
								createdAt: new Date(m.createdAt),
								status: { type: "complete", reason: "stop" } as const,
								attachments: [],
								metadata: { steps: [], custom: customMeta },
							},
							parentId: i === 0 ? null : messages[i - 1].id,
						};
					});

					return {
						headId:
							messages.length > 0 ? messages[messages.length - 1].id : null,
						messages: repoMessages,
					};
				},
				async append() {
					queryClient.invalidateQueries({ queryKey: ["conversations"] });
				},
			}) as unknown as ThreadHistoryAdapter,
		[conversationId, queryClient],
	);
}
