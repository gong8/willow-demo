import { useMessage } from "@assistant-ui/react";
import { useState } from "react";

export const actionButtonClass =
	"rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";

function formatTimestamp(date: Date): string {
	return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MessageTimestamp() {
	const createdAt = useMessage((m) => m.createdAt);
	if (!createdAt) return null;
	return (
		<span className="text-xs text-muted-foreground/60 select-none">
			{formatTimestamp(createdAt)}
		</span>
	);
}

export function EnlargeableImage({
	src,
	alt = "",
}: { src: string; alt?: string }) {
	const [enlarged, setEnlarged] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setEnlarged(true)} className="block">
				<img
					src={src}
					alt={alt}
					className="max-h-64 rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
				/>
			</button>
			{enlarged && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 cursor-pointer"
					onClick={() => setEnlarged(false)}
					onKeyDown={(e) => e.key === "Escape" && setEnlarged(false)}
				>
					<img
						src={src}
						alt={alt}
						className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
					/>
				</div>
			)}
		</>
	);
}
