import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Plus } from "lucide-react";
import { useState } from "react";
import {
	type ActiveView,
	ConversationSidebar,
} from "./components/ConversationSidebar.js";
import { ChatThread } from "./components/chat/ChatThread.js";
import { GraphView } from "./components/graph/GraphView.js";
import { HistoryView } from "./components/history/HistoryView.js";
import { ResourcesView } from "./components/resources/ResourcesView.js";
import { createConversation } from "./lib/api.js";

const queryClient = new QueryClient();

function EmptyState({ onCreated }: { onCreated: (id: string) => void }) {
	const qc = useQueryClient();

	const handleNew = async () => {
		const conv = await createConversation();
		qc.invalidateQueries({ queryKey: ["conversations"] });
		onCreated(conv.id);
	};

	return (
		<div className="flex h-full flex-col items-center justify-center gap-4">
			<MessageSquare className="h-12 w-12 text-muted-foreground/40" />
			<div className="text-center">
				<p className="text-sm text-muted-foreground">
					Select a conversation or start a new one
				</p>
			</div>
			<button
				type="button"
				onClick={handleNew}
				className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
			>
				<Plus className="h-4 w-4" />
				New chat
			</button>
		</div>
	);
}

function ChatApp() {
	const [activeConversationId, setActiveConversationId] = useState<
		string | null
	>(null);
	const [activeView, setActiveView] = useState<ActiveView>("chat");

	return (
		<div className="flex h-screen bg-background text-foreground">
			<ConversationSidebar
				activeId={activeConversationId}
				onSelect={setActiveConversationId}
				activeView={activeView}
				onViewChange={setActiveView}
			/>
			<div className="flex min-h-0 flex-1 flex-col">
				{activeView === "history" && <HistoryView />}
				{activeView === "resources" && <ResourcesView />}
				{activeView === "graph" && (
					<GraphView activeConversationId={activeConversationId} />
				)}
				{activeConversationId ? (
					<div
						className={
							activeView === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"
						}
					>
						<ChatThread
							key={activeConversationId}
							conversationId={activeConversationId}
						/>
					</div>
				) : (
					activeView === "chat" && (
						<EmptyState onCreated={(id) => setActiveConversationId(id)} />
					)
				)}
			</div>
		</div>
	);
}

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<ChatApp />
		</QueryClientProvider>
	);
}
