import {
	ChevronDown,
	ChevronRight,
	Loader2,
	type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

export function StatusIndicator({
	isActive,
	activeLabel,
	doneLabel,
	activeIcon: ActiveIcon,
	doneIcon: DoneIcon,
	iconColor,
	children,
	collapsible = true,
}: {
	isActive: boolean;
	activeLabel: string;
	doneLabel: string;
	activeIcon?: LucideIcon;
	doneIcon: LucideIcon;
	iconColor: string;
	children?: ReactNode;
	collapsible?: boolean;
}) {
	const [collapsed, setCollapsed] = useState(false);

	const SpinnerIcon = ActiveIcon ?? Loader2;

	const header = (
		<>
			{isActive ? (
				<SpinnerIcon
					className={`h-3.5 w-3.5 shrink-0 ${ActiveIcon ? iconColor : `animate-spin ${iconColor}`}`}
				/>
			) : (
				<DoneIcon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
			)}
			<span className="flex-1 text-muted-foreground">
				{isActive ? activeLabel : doneLabel}
			</span>
		</>
	);

	return (
		<div
			className={`my-1.5 rounded-lg border border-border bg-background text-sm transition-opacity ${
				!isActive ? "opacity-80" : "opacity-100"
			}`}
		>
			{collapsible ? (
				<button
					type="button"
					onClick={() => setCollapsed(!collapsed)}
					className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-lg"
				>
					{header}
					{collapsed ? (
						<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					) : (
						<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					)}
				</button>
			) : (
				<div className="flex items-center gap-2 px-3 py-2">{header}</div>
			)}
			{!collapsed && children && (
				<div className="border-t border-border px-3 py-2">{children}</div>
			)}
		</div>
	);
}
