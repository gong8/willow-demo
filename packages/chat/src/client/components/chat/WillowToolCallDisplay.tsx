import { type ToolCallMessagePartProps, useMessage } from "@assistant-ui/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type {
	IndexerResultsPart,
	SearchResultsPart,
} from "../../lib/chat-adapter.js";
import { IndexerIndicator } from "./IndexerIndicator.js";
import { SearchIndicator } from "./SearchIndicator.js";
import { ToolCallDisplay } from "./ToolCallDisplay.js";
import { WillowToolViz } from "./graph-viz/WillowToolViz.js";

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

function useGroupedToolCalls<T extends { toolCalls: ToolCallPart[] }>(
	props: ToolCallMessagePartProps,
	filter: (toolCallId: string) => boolean,
	metaSelector: (m: { metadata?: { custom?: Record<string, unknown> } }) =>
		| T
		| undefined,
	buildFallback: (calls: ToolCallPart[]) => T | null,
): { isFirst: boolean; part: T | null } {
	const content = useMessage((m) => m.content);
	const metaPart = useMessage(metaSelector as (m: unknown) => T | undefined);

	return useMemo(() => {
		let first: string | null = null;
		for (const p of content) {
			if (p.type === "tool-call" && filter(p.toolCallId)) {
				if (!first) first = p.toolCallId;
			}
		}

		if (metaPart) {
			return { isFirst: first === props.toolCallId, part: metaPart };
		}

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

		return { isFirst: first === props.toolCallId, part: buildFallback(calls) };
	}, [content, props.toolCallId, metaPart, filter, buildFallback]);
}

function GroupedHandler(
	props: ToolCallMessagePartProps & {
		filter: (id: string) => boolean;
		metaSelector: (m: { metadata?: { custom?: Record<string, unknown> } }) =>
			| SearchResultsPart
			| IndexerResultsPart
			| undefined;
		buildFallback: (
			calls: ToolCallPart[],
		) => SearchResultsPart | IndexerResultsPart | null;
		render: (part: SearchResultsPart | IndexerResultsPart) => ReactNode;
	},
) {
	const { isFirst, part } = useGroupedToolCalls(
		props,
		props.filter,
		props.metaSelector,
		props.buildFallback,
	);

	if (!isFirst || !part) return null;
	return <>{props.render(part)}</>;
}

const searchMetaSelector = (m: {
	metadata?: { custom?: Record<string, unknown> };
}) => m.metadata?.custom?.searchResults as SearchResultsPart | undefined;

const searchFallback = (calls: ToolCallPart[]): SearchResultsPart | null =>
	calls.length > 0
		? { type: "search-results", searchStatus: "done", toolCalls: calls }
		: null;

const indexerMetaSelector = (m: {
	metadata?: { custom?: Record<string, unknown> };
}) => m.metadata?.custom?.indexerResults as IndexerResultsPart | undefined;

const indexerFallback = (calls: ToolCallPart[]): IndexerResultsPart | null =>
	calls.length > 0
		? { type: "indexer-results", indexerStatus: "done", toolCalls: calls }
		: null;

const renderSearch = (part: SearchResultsPart | IndexerResultsPart) => (
	<SearchIndicator
		toolCalls={part.toolCalls}
		searchStatus={(part as SearchResultsPart).searchStatus}
	/>
);

const renderIndexer = (part: SearchResultsPart | IndexerResultsPart) => (
	<IndexerIndicator part={part as IndexerResultsPart} />
);

export function WillowToolCallDisplay(props: ToolCallMessagePartProps) {
	if (isSearchToolCall(props.toolCallId)) {
		return (
			<GroupedHandler
				{...props}
				filter={isSearchToolCall}
				metaSelector={searchMetaSelector}
				buildFallback={searchFallback}
				render={renderSearch}
			/>
		);
	}

	if (isIndexerToolCall(props.toolCallId)) {
		return (
			<GroupedHandler
				{...props}
				filter={isIndexerToolCall}
				metaSelector={indexerMetaSelector}
				buildFallback={indexerFallback}
				render={renderIndexer}
			/>
		);
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
