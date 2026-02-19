import { type ToolCallMessagePartProps, useMessage } from "@assistant-ui/react";
import { useMemo } from "react";
import type {
	IndexerResultsPart,
	SearchResultsPart,
} from "../../lib/chat-adapter.js";
import { IndexerIndicator } from "./IndexerIndicator.js";
import { SearchIndicator } from "./SearchIndicator.js";
import { ToolCallDisplay } from "./ToolCallDisplay.js";
import { WillowToolViz } from "./graph-viz/WillowToolViz.js";

/** Set to true to show the text tool call labels alongside graph viz */
const SHOW_TOOL_LABELS = false;

function isSearchToolCall(toolCallId: string): boolean {
	return toolCallId.startsWith("search__");
}

function isIndexerToolCall(toolCallId: string): boolean {
	return toolCallId.startsWith("indexer__");
}

/**
 * Renders the SearchIndicator for the first search tool call in the message.
 * Subsequent search tool calls return null (they're rendered inside the indicator).
 */
function SearchToolCallHandler(props: ToolCallMessagePartProps) {
	const content = useMessage((m) => m.content);

	const { isFirst, searchPart } = useMemo(() => {
		let first: string | null = null;

		for (const part of content) {
			if (part.type === "tool-call" && isSearchToolCall(part.toolCallId)) {
				if (!first) first = part.toolCallId;
			}
		}

		// Look for a search-results custom part
		for (const part of content) {
			const p = part as unknown as SearchResultsPart;
			if (p.type === "search-results") {
				return { isFirst: first === props.toolCallId, searchPart: p };
			}
		}

		// Fallback: build from individual tool calls
		const calls: SearchResultsPart["toolCalls"] = [];
		for (const part of content) {
			if (part.type === "tool-call" && isSearchToolCall(part.toolCallId)) {
				calls.push({
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					args: part.args as Record<string, unknown>,
					result: part.result as string | undefined,
					isError: part.isError,
				});
			}
		}

		return {
			isFirst: first === props.toolCallId,
			searchPart:
				calls.length > 0
					? ({
							type: "search-results",
							searchStatus: "done",
							toolCalls: calls,
						} as SearchResultsPart)
					: null,
		};
	}, [content, props.toolCallId]);

	if (!isFirst || !searchPart) return null;

	return <SearchIndicator toolCalls={searchPart.toolCalls} />;
}

/**
 * Renders the IndexerIndicator for the first indexer tool call in the message.
 * Subsequent indexer tool calls return null (they're rendered inside the indicator).
 */
function IndexerToolCallHandler(props: ToolCallMessagePartProps) {
	const content = useMessage((m) => m.content);

	const { isFirst, indexerPart } = useMemo(() => {
		let first: string | null = null;

		for (const part of content) {
			if (part.type === "tool-call" && isIndexerToolCall(part.toolCallId)) {
				if (!first) first = part.toolCallId;
			}
		}

		// Look for an indexer-results custom part
		for (const part of content) {
			const p = part as unknown as IndexerResultsPart;
			if (p.type === "indexer-results") {
				return { isFirst: first === props.toolCallId, indexerPart: p };
			}
		}

		// Fallback: build from individual tool calls
		const calls: IndexerResultsPart["toolCalls"] = [];
		for (const part of content) {
			if (part.type === "tool-call" && isIndexerToolCall(part.toolCallId)) {
				calls.push({
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					args: part.args as Record<string, unknown>,
					result: part.result as string | undefined,
					isError: part.isError,
				});
			}
		}

		return {
			isFirst: first === props.toolCallId,
			indexerPart:
				calls.length > 0
					? ({
							type: "indexer-results",
							indexerStatus: "done",
							toolCalls: calls,
						} as IndexerResultsPart)
					: null,
		};
	}, [content, props.toolCallId]);

	if (!isFirst || !indexerPart) return null;

	return <IndexerIndicator part={indexerPart} />;
}

export function WillowToolCallDisplay(props: ToolCallMessagePartProps) {
	// Search-phase tool calls are grouped into a SearchIndicator
	if (isSearchToolCall(props.toolCallId)) {
		return <SearchToolCallHandler {...props} />;
	}

	// Indexer-phase tool calls are grouped into an IndexerIndicator
	if (isIndexerToolCall(props.toolCallId)) {
		return <IndexerToolCallHandler {...props} />;
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
