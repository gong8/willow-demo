import {
	ActionBarPrimitive,
	MessagePrimitive,
	useMessage,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ClipboardCopy, RefreshCw } from "lucide-react";
import remarkGfm from "remark-gfm";
import type {
	IndexerResultsPart,
	SearchResultsPart,
} from "../../lib/chat-adapter.js";
import { IndexerIndicator } from "./IndexerIndicator.js";
import { ReasoningDisplay } from "./ReasoningDisplay.js";
import { SearchIndicator } from "./SearchIndicator.js";
import { WillowToolCallDisplay } from "./WillowToolCallDisplay.js";
import { MessageTimestamp, actionButtonClass } from "./message-utils.js";

function MarkdownText() {
	return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} />;
}

function SearchResults() {
	const searchPart = useMessage(
		(m) =>
			(m.metadata?.custom?.searchResults as SearchResultsPart | undefined) ??
			null,
	);
	if (!searchPart) return null;
	return (
		<SearchIndicator
			toolCalls={searchPart.toolCalls}
			searchStatus={searchPart.searchStatus}
		/>
	);
}

function IndexerResults() {
	const indexerPart = useMessage(
		(m) =>
			(m.metadata?.custom?.indexerResults as IndexerResultsPart | undefined) ??
			null,
	);
	if (!indexerPart) return null;
	return <IndexerIndicator part={indexerPart} />;
}

export function AssistantMessage() {
	return (
		<MessagePrimitive.Root className="group flex px-4 py-2">
			<div className="flex flex-col gap-1 max-w-full">
				<SearchResults />
				<div className="prose prose-sm max-w-none rounded-2xl bg-muted px-4 py-2">
					<MessagePrimitive.Content
						components={{
							Text: MarkdownText,
							Reasoning: ReasoningDisplay,
							tools: {
								Fallback: WillowToolCallDisplay,
							},
						}}
					/>
				</div>
				<IndexerResults />
				<div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
					<MessageTimestamp />
					<ActionBarPrimitive.Root className="flex items-center gap-1">
						<ActionBarPrimitive.Copy
							copiedDuration={2000}
							className={actionButtonClass}
						>
							<ClipboardCopy className="h-4 w-4" />
						</ActionBarPrimitive.Copy>
						<ActionBarPrimitive.Reload className={actionButtonClass}>
							<RefreshCw className="h-4 w-4" />
						</ActionBarPrimitive.Reload>
					</ActionBarPrimitive.Root>
				</div>
			</div>
		</MessagePrimitive.Root>
	);
}
