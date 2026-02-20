import {
	ActionBarPrimitive,
	MessagePrimitive,
	useAttachmentRuntime,
	useMessagePartImage,
} from "@assistant-ui/react";
import { ClipboardCopy, Pencil } from "lucide-react";
import {
	EnlargeableImage,
	MessageActionBar,
	actionButtonClass,
	sameComponent,
} from "./message-utils.js";

function UserImagePart() {
	const image = useMessagePartImage();
	if (!image?.image) return null;
	return <EnlargeableImage src={image.image} />;
}

function UserMessageAttachment() {
	const attachmentRuntime = useAttachmentRuntime();
	const state = attachmentRuntime.getState();
	if (state.type !== "image") return null;
	return (
		<EnlargeableImage
			src={`/api/chat/attachments/${state.id}`}
			alt={state.name}
		/>
	);
}

export function UserMessage() {
	return (
		<MessagePrimitive.Root className="group flex justify-end px-4 py-2">
			<div className="flex flex-col items-end gap-1 max-w-[80%]">
				<MessagePrimitive.Attachments
					components={sameComponent(UserMessageAttachment)}
				/>
				<div className="rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
					<MessagePrimitive.Content components={{ Image: UserImagePart }} />
				</div>
				<MessageActionBar>
					<ActionBarPrimitive.Edit className={actionButtonClass}>
						<Pencil className="h-4 w-4" />
					</ActionBarPrimitive.Edit>
					<ActionBarPrimitive.Copy
						copiedDuration={2000}
						className={actionButtonClass}
					>
						<ClipboardCopy className="h-4 w-4" />
					</ActionBarPrimitive.Copy>
				</MessageActionBar>
			</div>
		</MessagePrimitive.Root>
	);
}
