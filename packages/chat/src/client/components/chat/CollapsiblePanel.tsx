import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

export function CollapsiblePanel({
	header,
	children,
	className = "",
	disabled = false,
}: {
	header: ReactNode;
	children: ReactNode;
	className?: string;
	disabled?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const isOpen = expanded && !disabled;

	return (
		<div
			className={`my-1.5 rounded-lg border border-border text-sm ${className}`}
		>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				disabled={disabled}
				className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-lg"
			>
				{header}
				{!disabled &&
					(isOpen ? (
						<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					))}
			</button>
			{isOpen && (
				<div className="border-t border-border px-3 py-2">{children}</div>
			)}
		</div>
	);
}
