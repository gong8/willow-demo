import { GitCommit } from "lucide-react";
import type { CommitEntry } from "../../lib/api.js";

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

const SOURCE_COLORS: Record<string, string> = {
	conversation: "bg-blue-500/15 text-blue-400",
	maintenance: "bg-amber-500/15 text-amber-400",
	manual: "bg-green-500/15 text-green-400",
	merge: "bg-purple-500/15 text-purple-400",
	restore: "bg-rose-500/15 text-rose-400",
};

export function CommitLog({
	commits,
	selectedHash,
	onSelect,
}: {
	commits: CommitEntry[];
	selectedHash: string | null;
	onSelect: (hash: string) => void;
}) {
	if (commits.length === 0) {
		return (
			<div className="flex h-full w-80 flex-col items-center justify-center border-r border-border p-4 text-muted-foreground">
				<GitCommit className="mb-2 h-8 w-8 opacity-30" />
				<p className="text-sm">No commits yet</p>
			</div>
		);
	}

	return (
		<div className="flex h-full w-80 flex-col border-r border-border">
			<div className="flex-1 overflow-y-auto">
				{commits.map((commit, i) => {
					const isSelected = commit.hash === selectedHash;
					const colorClass =
						SOURCE_COLORS[commit.source] ?? "bg-muted text-muted-foreground";

					return (
						<button
							key={commit.hash}
							type="button"
							onClick={() => onSelect(commit.hash)}
							className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors ${
								isSelected ? "bg-accent" : "hover:bg-accent/50"
							}`}
						>
							<div className="flex items-center gap-2">
								<GitCommit
									className={`h-3.5 w-3.5 shrink-0 ${
										i === 0 ? "text-foreground" : "text-muted-foreground"
									}`}
								/>
								<span className="font-mono text-xs text-muted-foreground">
									{commit.hash.slice(0, 7)}
								</span>
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
				})}
			</div>
		</div>
	);
}
