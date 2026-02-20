import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { IndexerResultsPart } from "../../lib/chat-adapter";
import { IndexerIndicator } from "./IndexerIndicator";
import { ReasoningDisplay } from "./ReasoningDisplay";
import { SearchIndicator } from "./SearchIndicator";
import { ToolCallStatusIcon, getToolLabel } from "./ToolCallDisplay";
import {
	isCoordinatorSearchTool,
	isIndexerToolCall,
	isSearchToolCall,
} from "./WillowToolCallDisplay";

export interface ReconnectStream {
	content: string;
	toolCalls: Map<
		string,
		{
			toolCallId: string;
			toolName: string;
			args?: Record<string, unknown>;
			result?: string;
			isError?: boolean;
		}
	>;
	thinkingText: string;
	done: boolean;
}

interface ToolCallEntry {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

function categorizeToolCalls(toolCalls: ReconnectStream["toolCalls"]): {
	searchCalls: ToolCallEntry[];
	indexerPart: IndexerResultsPart | null;
	regularCalls: ToolCallEntry[];
	hasSearchPhase: boolean;
	searchDone: boolean;
} {
	const searchCalls: ToolCallEntry[] = [];
	const indexerCalls: ToolCallEntry[] = [];
	const regularCalls: ToolCallEntry[] = [];

	for (const tc of toolCalls.values()) {
		const entry: ToolCallEntry = {
			toolCallId: tc.toolCallId,
			toolName: tc.toolName,
			args: tc.args ?? {},
			result: tc.result,
			isError: tc.isError,
		};

		if (isSearchToolCall(tc.toolCallId)) {
			searchCalls.push(entry);
		} else if (isIndexerToolCall(tc.toolCallId)) {
			indexerCalls.push(entry);
		} else if (!isCoordinatorSearchTool(tc.toolName)) {
			regularCalls.push(entry);
		}
	}

	const searchDone =
		searchCalls.length > 0 &&
		searchCalls.every((tc) => tc.result !== undefined);

	const indexerDone =
		indexerCalls.length > 0 &&
		indexerCalls.every((tc) => tc.result !== undefined);

	return {
		searchCalls,
		indexerPart:
			indexerCalls.length > 0
				? {
						type: "indexer-results",
						indexerStatus: indexerDone ? "done" : "running",
						toolCalls: indexerCalls,
					}
				: null,
		regularCalls,
		hasSearchPhase: searchCalls.length > 0,
		searchDone,
	};
}

function RegularToolCall({ tc }: { tc: ToolCallEntry }) {
	const hasResult = tc.result !== undefined;
	const label = getToolLabel(tc.toolName, tc.args);

	return (
		<div className="my-1.5 rounded-lg border border-border bg-background text-sm">
			<div className="flex items-center gap-2 px-3 py-2">
				<ToolCallStatusIcon isError={tc.isError} hasResult={hasResult} />
				<span
					className={`flex-1 truncate ${tc.isError ? "text-destructive" : "text-muted-foreground"}`}
				>
					{hasResult ? label : `${label}...`}
				</span>
			</div>
		</div>
	);
}

export function ReconnectStreamView({ stream }: { stream: ReconnectStream }) {
	const cleanContent = stream.content
		.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
		.replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
		.replace(/<tool_call[\s\S]*$/, "")
		.replace(/<tool_result[\s\S]*$/, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const grouped = useMemo(
		() => categorizeToolCalls(stream.toolCalls),
		[stream.toolCalls],
	);

	return (
		<div className="group flex px-4 py-2">
			<div className="flex flex-col gap-1 max-w-full">
				{grouped.hasSearchPhase && (
					<SearchIndicator
						toolCalls={grouped.searchCalls}
						searchStatus={grouped.searchDone ? "done" : "searching"}
						collapsible={false}
					/>
				)}
				<div className="prose prose-sm max-w-none rounded-2xl bg-muted px-4 py-2">
					{stream.thinkingText && (
						<ReasoningDisplay type="reasoning" text={stream.thinkingText} />
					)}
					{grouped.regularCalls.map((tc) => (
						<RegularToolCall key={tc.toolCallId} tc={tc} />
					))}
					{cleanContent && (
						<ReactMarkdown remarkPlugins={[remarkGfm]}>
							{cleanContent}
						</ReactMarkdown>
					)}
				</div>
				{grouped.indexerPart && (
					<IndexerIndicator part={grouped.indexerPart} collapsible={false} />
				)}
			</div>
		</div>
	);
}
