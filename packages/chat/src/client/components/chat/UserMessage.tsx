import {
	ActionBarPrimitive,
	MessagePrimitive,
	useAttachmentRuntime,
	useMessagePartImage,
} from "@assistant-ui/react";
import { Pencil } from "lucide-react";
import {
	CopyAction,
	EnlargeableImage,
	MessageShell,
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
		<MessageShell
			align="end"
			actions={
				<>
					<ActionBarPrimitive.Edit className={actionButtonClass}>
						<Pencil className="h-4 w-4" />
					</ActionBarPrimitive.Edit>
					<CopyAction />
				</>
			}
		>
			<MessagePrimitive.Attachments
				components={sameComponent(UserMessageAttachment)}
			/>
			<div className="rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
				<MessagePrimitive.Content components={{ Image: UserImagePart }} />
			</div>
		</MessageShell>
	);
}
