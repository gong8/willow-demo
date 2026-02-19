import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Network, Plus, Trash2 } from "lucide-react";
import {
	type Conversation,
	createConversation,
	deleteConversation,
	fetchConversations,
} from "../lib/api.js";

export type ActiveView = "chat" | "graph";

export function ConversationSidebar({
	activeId,
	onSelect,
	activeView,
	onViewChange,
}: {
	activeId: string | null;
	onSelect: (id: string) => void;
	activeView: ActiveView;
	onViewChange: (view: ActiveView) => void;
}) {
	const queryClient = useQueryClient();

	const { data: conversations = [] } = useQuery<Conversation[]>({
		queryKey: ["conversations"],
		queryFn: fetchConversations,
		refetchInterval: 10000,
	});

	const handleNew = async () => {
		const conv = await createConversation();
		queryClient.invalidateQueries({ queryKey: ["conversations"] });
		onSelect(conv.id);
	};

	const handleDelete = async (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		await deleteConversation(id);
		queryClient.invalidateQueries({ queryKey: ["conversations"] });
		if (activeId === id) {
			const remaining = conversations.filter((c) => c.id !== id);
			if (remaining.length > 0) {
				onSelect(remaining[0].id);
			} else {
				const conv = await createConversation();
				queryClient.invalidateQueries({ queryKey: ["conversations"] });
				onSelect(conv.id);
			}
		}
	};

	const handleSelectConversation = (id: string) => {
		onSelect(id);
		onViewChange("chat");
	};

	return (
		<div className="flex h-full w-64 flex-col border-r border-border bg-muted/30">
			<div className="flex items-center justify-between border-b border-border p-3">
				<h1 className="text-sm font-semibold text-foreground">Willow</h1>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => onViewChange("chat")}
						className={`rounded-md p-1.5 transition-colors ${
							activeView === "chat"
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:bg-accent hover:text-foreground"
						}`}
						title="Chat"
					>
						<MessageSquare className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => onViewChange("graph")}
						className={`rounded-md p-1.5 transition-colors ${
							activeView === "graph"
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:bg-accent hover:text-foreground"
						}`}
						title="Knowledge graph"
					>
						<Network className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={handleNew}
						className="rounded-md border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						title="New conversation"
					>
						<Plus className="h-4 w-4" />
					</button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-2">
				{conversations.map((conv) => (
					<div
						key={conv.id}
						role="button"
						tabIndex={0}
						onClick={() => handleSelectConversation(conv.id)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								handleSelectConversation(conv.id);
							}
						}}
						className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
							activeView === "chat" && activeId === conv.id
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:bg-accent/50"
						}`}
					>
						<MessageSquare className="h-3.5 w-3.5 shrink-0" />
						<span className="flex-1 truncate">{conv.title}</span>
						<button
							type="button"
							onClick={(e) => handleDelete(conv.id, e)}
							className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
							title="Delete"
						>
							<Trash2 className="h-3 w-3" />
						</button>
					</div>
				))}

				{conversations.length === 0 && (
					<p className="px-3 py-4 text-center text-xs text-muted-foreground">
						No conversations yet
					</p>
				)}
			</div>
		</div>
	);
}
