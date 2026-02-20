import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { IndexerResultsPart } from "../../lib/chat-adapter.js";
import { IndexerIndicator } from "./IndexerIndicator.js";
import { ReasoningDisplay } from "./ReasoningDisplay.js";
import { SearchIndicator } from "./SearchIndicator.js";
import { getToolLabel } from "./ToolCallDisplay.js";

// ─── Types ───

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

// ─── Helpers ───

function isSearchToolCall(toolCallId: string): boolean {
	return toolCallId.startsWith("search__");
}

function isCoordinatorSearchTool(toolName: string): boolean {
	return toolName === "mcp__coordinator__search_memories";
}

function isIndexerToolCall(toolCallId: string): boolean {
	return toolCallId.startsWith("indexer__");
}

interface ToolCallEntry {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

// ─── Reconnect Stream View ───

export function ReconnectStreamView({ stream }: { stream: ReconnectStream }) {
	const cleanContent = stream.content
		.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
		.replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
		.replace(/<tool_call[\s\S]*$/, "")
		.replace(/<tool_result[\s\S]*$/, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const { searchCalls, indexerPart, regularCalls, hasSearchPhase, searchDone } =
		useMemo(() => {
			const searchCalls: ToolCallEntry[] = [];
			const indexerCalls: ToolCallEntry[] = [];
			const regularCalls: ToolCallEntry[] = [];

			for (const tc of stream.toolCalls.values()) {
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

			const indexerPart: IndexerResultsPart | null =
				indexerCalls.length > 0
					? {
							type: "indexer-results",
							indexerStatus: indexerDone ? "done" : "running",
							toolCalls: indexerCalls,
						}
					: null;

			return {
				searchCalls,
				indexerPart,
				regularCalls,
				hasSearchPhase: searchCalls.length > 0,
				searchDone,
			};
		}, [stream.toolCalls]);

	return (
		<div className="group flex px-4 py-2">
			<div className="flex flex-col gap-1 max-w-full">
				{hasSearchPhase && (
					<SearchIndicator
						toolCalls={searchCalls}
						searchStatus={searchDone ? "done" : "searching"}
						collapsible={false}
					/>
				)}
				<div className="prose prose-sm max-w-none rounded-2xl bg-muted px-4 py-2">
					{stream.thinkingText && (
						<ReasoningDisplay type="reasoning" text={stream.thinkingText} />
					)}
					{regularCalls.map((tc) => {
						const hasResult = tc.result !== undefined;
						const label = getToolLabel(tc.toolName, tc.args);
						return (
							<div
								key={tc.toolCallId}
								className="my-1.5 rounded-lg border border-border bg-background text-sm"
							>
								<div className="flex items-center gap-2 px-3 py-2">
									{tc.isError ? (
										<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
									) : hasResult ? (
										<Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
									) : (
										<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
									)}
									<span
										className={`flex-1 truncate ${tc.isError ? "text-destructive" : "text-muted-foreground"}`}
									>
										{hasResult ? label : `${label}...`}
									</span>
								</div>
							</div>
						);
					})}
					{cleanContent && (
						<ReactMarkdown remarkPlugins={[remarkGfm]}>
							{cleanContent}
						</ReactMarkdown>
					)}
				</div>
				{indexerPart && (
					<IndexerIndicator part={indexerPart} collapsible={false} />
				)}
			</div>
		</div>
	);
}
