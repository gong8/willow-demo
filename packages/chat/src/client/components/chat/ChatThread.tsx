import {
	AssistantRuntimeProvider,
	ThreadPrimitive,
	useLocalRuntime,
} from "@assistant-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useChatHistory } from "../../hooks/useChatHistory.js";
import { useStreamReconnect } from "../../hooks/useStreamReconnect.js";
import {
	chatAttachmentAdapter,
	createWillowChatAdapter,
} from "../../lib/chat-adapter.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { ChatComposer, DraftPersistence } from "./ChatComposer.js";
import { EditComposer } from "./EditComposer.js";
import { ReconnectStreamView } from "./ReconnectStreamView.js";
import { UserMessage } from "./UserMessage.js";

export function ChatThread({
	conversationId,
}: {
	conversationId: string;
}) {
	const queryClient = useQueryClient();

	const adapterStreamingRef = useRef(false);
	const adapter = useMemo(() => {
		const base = createWillowChatAdapter(conversationId);
		return {
			...base,
			async *run(options: Parameters<typeof base.run>[0]) {
				adapterStreamingRef.current = true;
				try {
					const result = base.run(options);
					if (Symbol.asyncIterator in result) {
						let first = true;
						for await (const chunk of result) {
							if (first) {
								first = false;
								queryClient.invalidateQueries({
									queryKey: ["conversations"],
								});
							}
							yield chunk;
						}
					} else {
						yield await result;
					}
				} finally {
					adapterStreamingRef.current = false;
					queryClient.invalidateQueries({
						queryKey: ["conversations"],
					});
					queryClient.invalidateQueries({
						queryKey: ["graph"],
					});
				}
			},
		};
	}, [conversationId, queryClient]);

	const history = useChatHistory(conversationId, queryClient);

	const runtime = useLocalRuntime(adapter, {
		adapters: {
			attachments: chatAttachmentAdapter,
			history,
		},
	});

	const { reconnectStream, reconnectViewportRef } = useStreamReconnect(
		conversationId,
		adapterStreamingRef,
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				try {
					runtime.thread.cancelRun();
				} catch {
					// Not streaming, ignore
				}
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [runtime]);

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<DraftPersistence conversationId={conversationId} />
			<div className="flex h-full min-h-0 flex-col">
				<ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
					<ThreadPrimitive.Viewport
						ref={reconnectViewportRef}
						className="min-h-0 flex-1 overflow-y-auto scroll-smooth"
					>
						<ThreadPrimitive.Empty>
							<div className="flex h-full flex-col items-center justify-center gap-2 text-center">
								<h2 className="text-lg font-medium text-foreground">Willow</h2>
								<p className="max-w-md text-sm text-muted-foreground">
									I'm your personal knowledge assistant. Tell me about yourself
									and I'll remember it across conversations. Ask me anything —
									I'll check my memory first.
								</p>
							</div>
						</ThreadPrimitive.Empty>
						<ThreadPrimitive.Messages
							components={{
								UserMessage,
								AssistantMessage,
								EditComposer,
							}}
						/>
						{reconnectStream && (
							<ReconnectStreamView stream={reconnectStream} />
						)}
					</ThreadPrimitive.Viewport>

					<ThreadPrimitive.ScrollToBottom className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background p-2 shadow-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all z-10 disabled:pointer-events-none disabled:opacity-0">
						<ChevronDown className="h-4 w-4" />
					</ThreadPrimitive.ScrollToBottom>

					<ChatComposer />
				</ThreadPrimitive.Root>
			</div>
		</AssistantRuntimeProvider>
	);
}
