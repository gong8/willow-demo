import { CircleDot, GitCommit, GitCompare } from "lucide-react";
import type { CommitEntry } from "../../lib/api";
import { DEFAULT_COLOR, SOURCE_COLORS } from "./sourceColors";

function relativeTime(timestamp: string): string {
	const now = Date.now();
	const then = new Date(timestamp).getTime();
	const diff = now - then;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function CommitRow({
	commit,
	isSelected,
	isHead,
	isCompareSelected,
	onSelect,
	onCompareSelect,
}: {
	commit: CommitEntry;
	isSelected: boolean;
	isHead: boolean;
	isCompareSelected: boolean;
	onSelect: (hash: string) => void;
	onCompareSelect?: (hash: string) => void;
}) {
	const colorClass = (SOURCE_COLORS[commit.source] ?? DEFAULT_COLOR).bg;

	return (
		<button
			key={commit.hash}
			type="button"
			onClick={(e) => {
				if (e.shiftKey && onCompareSelect) {
					onCompareSelect(commit.hash);
				} else {
					onSelect(commit.hash);
				}
			}}
			className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors ${
				isCompareSelected
					? "bg-blue-500/10 ring-1 ring-inset ring-blue-500/30"
					: isSelected
						? "bg-accent"
						: "hover:bg-accent/50"
			}`}
		>
			<div className="flex items-center gap-2">
				<GitCommit
					className={`h-3.5 w-3.5 shrink-0 ${
						isHead ? "text-foreground" : "text-muted-foreground"
					}`}
				/>
				<span className="font-mono text-xs text-muted-foreground">
					{commit.hash.slice(0, 7)}
				</span>
				{isHead && (
					<span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
						current
					</span>
				)}
				<span className="ml-auto text-xs text-muted-foreground">
					{relativeTime(commit.timestamp)}
				</span>
			</div>
			<p className="truncate pl-5.5 text-sm text-foreground">
				{commit.message}
			</p>
			<div className="pl-5.5">
				<span
					className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}
				>
					{commit.source}
				</span>
			</div>
		</button>
	);
}

export function CommitLog({
	commits,
	selectedHash,
	headHash,
	hasLocalChanges,
	showLocalSelected,
	onSelect,
	onSelectLocalChanges,
	compareSelections = [],
	onCompareSelect,
	onCompare,
}: {
	commits: CommitEntry[];
	selectedHash: string | null;
	headHash: string | null;
	hasLocalChanges: boolean;
	showLocalSelected?: boolean;
	onSelect: (hash: string) => void;
	onSelectLocalChanges?: () => void;
	compareSelections?: string[];
	onCompareSelect?: (hash: string) => void;
	onCompare?: () => void;
}) {
	if (commits.length === 0) {
		return (
			<div className="flex h-full w-80 flex-col items-center justify-center border-r border-border p-4 text-muted-foreground">
				<GitCommit className="mb-2 h-8 w-8 opacity-30" />
				<p className="text-sm">No commits match filter</p>
			</div>
		);
	}

	return (
		<div className="flex h-full w-80 flex-col border-r border-border">
			{onCompareSelect && (
				<div className="flex items-center gap-2 border-b border-border px-4 py-2">
					<GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-xs text-muted-foreground">
						{compareSelections.length === 0
							? "Shift-click to compare"
							: `${compareSelections.length}/2 selected`}
					</span>
					{onCompare && (
						<button
							type="button"
							onClick={onCompare}
							className="ml-auto rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent/80"
						>
							Compare
						</button>
					)}
				</div>
			)}

			<div className="flex-1 overflow-y-auto">
				{hasLocalChanges && (
					<button
						type="button"
						onClick={onSelectLocalChanges}
						className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors ${
							showLocalSelected
								? "bg-amber-500/10"
								: "bg-amber-500/5 hover:bg-amber-500/10"
						}`}
					>
						<div className="flex items-center gap-2">
							<CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-400" />
							<span className="text-xs font-medium text-amber-400">
								Uncommitted changes
							</span>
						</div>
						<p className="truncate pl-5.5 text-xs text-muted-foreground">
							Working graph differs from last commit
						</p>
					</button>
				)}

				{commits.map((commit) => (
					<CommitRow
						key={commit.hash}
						commit={commit}
						isSelected={commit.hash === selectedHash}
						isHead={commit.hash === headHash}
						isCompareSelected={compareSelections.includes(commit.hash)}
						onSelect={onSelect}
						onCompareSelect={onCompareSelect}
					/>
				))}
			</div>
		</div>
	);
}
