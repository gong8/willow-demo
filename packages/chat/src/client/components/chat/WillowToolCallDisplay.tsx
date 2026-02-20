import { type ToolCallMessagePartProps, useMessage } from "@assistant-ui/react";
import { useMemo } from "react";
import type {
	IndexerResultsPart,
	SearchResultsPart,
} from "../../lib/chat-adapter";
import { IndexerIndicator } from "./IndexerIndicator";
import { SearchIndicator } from "./SearchIndicator";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { WillowToolViz } from "./graph-viz/WillowToolViz";

const SHOW_TOOL_LABELS = false;

export function isSearchToolCall(toolCallId: string): boolean {
	return toolCallId.startsWith("search__");
}

export function isIndexerToolCall(toolCallId: string): boolean {
	return toolCallId.startsWith("indexer__");
}

export function isCoordinatorSearchTool(toolName: string): boolean {
	return toolName === "mcp__coordinator__search_memories";
}

interface ToolCallPart {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

function useIsFirstOfGroup(
	toolCallId: string,
	filter: (id: string) => boolean,
): boolean {
	const content = useMessage((m) => m.content);
	return useMemo(() => {
		for (const p of content) {
			if (p.type === "tool-call" && filter(p.toolCallId)) {
				return p.toolCallId === toolCallId;
			}
		}
		return false;
	}, [content, toolCallId, filter]);
}

function useGroupFallback<T>(
	metaSelector: (m: { metadata?: { custom?: Record<string, unknown> } }) =>
		| T
		| undefined,
	filter: (id: string) => boolean,
	buildFallback: (calls: ToolCallPart[]) => T | null,
): T | null {
	const content = useMessage((m) => m.content);
	const metaPart = useMessage(metaSelector as (m: unknown) => T | undefined);
	return useMemo(() => {
		if (metaPart) return metaPart;
		const calls: ToolCallPart[] = [];
		for (const p of content) {
			if (p.type === "tool-call" && filter(p.toolCallId)) {
				calls.push({
					toolCallId: p.toolCallId,
					toolName: p.toolName,
					args: p.args as Record<string, unknown>,
					result: p.result as string | undefined,
					isError: p.isError,
				});
			}
		}
		return buildFallback(calls);
	}, [content, metaPart, filter, buildFallback]);
}

const searchMeta = (m: { metadata?: { custom?: Record<string, unknown> } }) =>
	m.metadata?.custom?.searchResults as SearchResultsPart | undefined;

const searchFallback = (calls: ToolCallPart[]): SearchResultsPart | null =>
	calls.length > 0
		? { type: "search-results", searchStatus: "done", toolCalls: calls }
		: null;

const indexerMeta = (m: { metadata?: { custom?: Record<string, unknown> } }) =>
	m.metadata?.custom?.indexerResults as IndexerResultsPart | undefined;

const indexerFallback = (calls: ToolCallPart[]): IndexerResultsPart | null =>
	calls.length > 0
		? { type: "indexer-results", indexerStatus: "done", toolCalls: calls }
		: null;

function SearchGroup({ toolCallId }: { toolCallId: string }) {
	const isFirst = useIsFirstOfGroup(toolCallId, isSearchToolCall);
	const part = useGroupFallback(searchMeta, isSearchToolCall, searchFallback);
	if (!isFirst || !part) return null;
	return (
		<SearchIndicator
			toolCalls={part.toolCalls}
			searchStatus={part.searchStatus}
		/>
	);
}

function IndexerGroup({ toolCallId }: { toolCallId: string }) {
	const isFirst = useIsFirstOfGroup(toolCallId, isIndexerToolCall);
	const part = useGroupFallback(
		indexerMeta,
		isIndexerToolCall,
		indexerFallback,
	);
	if (!isFirst || !part) return null;
	return <IndexerIndicator part={part} />;
}

export function WillowToolCallDisplay(props: ToolCallMessagePartProps) {
	if (isSearchToolCall(props.toolCallId)) {
		return <SearchGroup toolCallId={props.toolCallId} />;
	}

	if (isIndexerToolCall(props.toolCallId)) {
		return <IndexerGroup toolCallId={props.toolCallId} />;
	}

	if (isCoordinatorSearchTool(props.toolName)) {
		return null;
	}

	const isWillow = props.toolName.startsWith("mcp__willow__");

	return (
		<>
			{(!isWillow || SHOW_TOOL_LABELS) && <ToolCallDisplay {...props} />}
			{isWillow && (
				<WillowToolViz
					toolName={props.toolName}
					args={props.args}
					result={props.result}
					isError={props.isError}
				/>
			)}
		</>
	);
}
