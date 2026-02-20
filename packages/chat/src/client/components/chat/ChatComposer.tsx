import {
	AttachmentPrimitive,
	ComposerPrimitive,
	ThreadPrimitive,
	useAttachmentRuntime,
	useComposerRuntime,
	useThreadRuntime,
} from "@assistant-ui/react";
import { Paperclip, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function StopButton() {
	const threadRuntime = useThreadRuntime();

	return (
		<button
			type="button"
			onClick={() => threadRuntime.cancelRun()}
			className="shrink-0 rounded-lg bg-destructive p-2 text-destructive-foreground hover:opacity-90 transition-colors"
			title="Stop generation (Escape)"
		>
			<Square className="h-4 w-4" />
		</button>
	);
}

function ComposerImageAttachment() {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const attachmentRuntime = useAttachmentRuntime();
	const state = attachmentRuntime.getState();

	useEffect(() => {
		const file = (state as { file?: File }).file;
		if (file && file.size > 0) {
			const url = URL.createObjectURL(file);
			setPreviewUrl(url);
			return () => URL.revokeObjectURL(url);
		}
		if (state.id) {
			setPreviewUrl(`/api/chat/attachments/${state.id}`);
		}
	}, [state]);

	return (
		<AttachmentPrimitive.Root className="relative inline-block m-2">
			<div className="h-16 w-16 overflow-hidden rounded-lg border border-border bg-muted">
				{previewUrl ? (
					<img
						src={previewUrl}
						alt={state.name}
						className="h-full w-full object-cover"
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
						{state.name?.split(".").pop()?.toUpperCase() || "IMG"}
					</div>
				)}
			</div>
			<AttachmentPrimitive.Remove className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border text-muted-foreground hover:text-foreground text-xs">
				<X className="h-3 w-3" />
			</AttachmentPrimitive.Remove>
		</AttachmentPrimitive.Root>
	);
}

// ─── Draft Persistence ───

interface DraftData {
	text: string;
	attachments: Array<{ id: string; name: string; contentType: string }>;
}

function getDraftKey(conversationId: string) {
	return `chat-draft::${conversationId}`;
}

export function DraftPersistence({
	conversationId,
}: { conversationId: string }) {
	const composerRuntime = useComposerRuntime();
	const draftKey = getDraftKey(conversationId);
	const restoredRef = useRef(false);

	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;
		const raw = sessionStorage.getItem(draftKey);
		if (!raw) return;
		try {
			const draft: DraftData = JSON.parse(raw);
			if (draft.text) {
				composerRuntime.setText(draft.text);
			}
			for (const att of draft.attachments) {
				const restoreName = `__restore__${att.id}__${att.name}`;
				const fakeFile = new File([], restoreName, { type: att.contentType });
				composerRuntime.addAttachment(fakeFile).catch(() => {});
			}
		} catch {
			// Invalid draft data, ignore
		}
	}, [draftKey, composerRuntime]);

	useEffect(() => {
		const save = () => {
			const state = composerRuntime.getState();
			const draft: DraftData = {
				text: state.text,
				attachments: state.attachments.map((a) => ({
					id: a.id,
					name: a.name,
					contentType: a.contentType ?? "",
				})),
			};
			if (draft.text || draft.attachments.length > 0) {
				sessionStorage.setItem(draftKey, JSON.stringify(draft));
			} else {
				sessionStorage.removeItem(draftKey);
			}
		};

		const interval = setInterval(save, 2000);
		return () => {
			clearInterval(interval);
			save();
		};
	}, [composerRuntime, draftKey]);

	return null;
}

export function ChatComposer() {
	return (
		<div className="shrink-0 border-t border-border p-4">
			<ComposerPrimitive.Root className="rounded-xl border border-input bg-background">
				<ComposerPrimitive.Attachments
					components={{
						Image: ComposerImageAttachment,
						File: ComposerImageAttachment,
						Attachment: ComposerImageAttachment,
					}}
				/>
				<div className="flex items-center gap-2 px-3 py-2">
					<ComposerPrimitive.AddAttachment className="shrink-0 rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
						<Paperclip className="h-4 w-4" />
					</ComposerPrimitive.AddAttachment>
					<ComposerPrimitive.Input
						placeholder="Type a message..."
						className="flex-1 resize-none bg-transparent text-sm outline-none max-h-[200px] overflow-y-auto"
						autoFocus
					/>
					<ThreadPrimitive.If running>
						<StopButton />
					</ThreadPrimitive.If>
					<ThreadPrimitive.If running={false}>
						<ComposerPrimitive.Send className="shrink-0 rounded-lg bg-primary p-2 text-primary-foreground hover:opacity-90 disabled:opacity-50">
							<Send className="h-4 w-4" />
						</ComposerPrimitive.Send>
					</ThreadPrimitive.If>
				</div>
			</ComposerPrimitive.Root>
		</div>
	);
}
