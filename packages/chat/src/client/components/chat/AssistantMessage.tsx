import {
	ActionBarPrimitive,
	MessagePrimitive,
	useMessage,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { RefreshCw } from "lucide-react";
import remarkGfm from "remark-gfm";
import type {
	IndexerResultsPart,
	SearchResultsPart,
} from "../../lib/chat-adapter.js";
import { IndexerIndicator } from "./IndexerIndicator.js";
import { ReasoningDisplay } from "./ReasoningDisplay.js";
import { SearchIndicator } from "./SearchIndicator.js";
import { WillowToolCallDisplay } from "./WillowToolCallDisplay.js";
import {
	CopyAction,
	MessageShell,
	actionButtonClass,
} from "./message-utils.js";

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
		<MessageShell
			actions={
				<>
					<CopyAction />
					<ActionBarPrimitive.Reload className={actionButtonClass}>
						<RefreshCw className="h-4 w-4" />
					</ActionBarPrimitive.Reload>
				</>
			}
		>
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
		</MessageShell>
	);
}
