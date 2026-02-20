export type SourceFilter = "conversation" | "maintenance" | "manual";

export const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
	{ value: "conversation", label: "Conversation" },
	{ value: "maintenance", label: "Maintenance" },
	{ value: "manual", label: "Manual" },
];

export const SOURCE_COLORS: Record<string, { bg: string; badge: string }> = {
	conversation: {
		bg: "bg-blue-500/15 text-blue-400",
		badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
	},
	maintenance: {
		bg: "bg-amber-500/15 text-amber-400",
		badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
	},
	manual: {
		bg: "bg-green-500/15 text-green-400",
		badge: "bg-green-500/15 text-green-400 border-green-500/30",
	},
	merge: {
		bg: "bg-purple-500/15 text-purple-400",
		badge: "bg-purple-500/15 text-purple-400 border-purple-500/30",
	},
	restore: {
		bg: "bg-rose-500/15 text-rose-400",
		badge: "bg-rose-500/15 text-rose-400 border-rose-500/30",
	},
};

export const DEFAULT_COLOR = {
	bg: "bg-muted text-muted-foreground",
	badge: "bg-muted text-muted-foreground border-muted",
};
