import {
	AlertCircle,
	CheckCircle,
	Clock,
	FileText,
	Globe,
	Loader2,
} from "lucide-react";
import type { Resource } from "../../lib/api.js";

function StatusBadge({ status }: { status: Resource["status"] }) {
	switch (status) {
		case "pending":
			return (
				<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
					<Clock className="h-2.5 w-2.5" />
					Pending
				</span>
			);
		case "extracting":
			return (
				<span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-500">
					<Loader2 className="h-2.5 w-2.5 animate-spin" />
					Extracting
				</span>
			);
		case "ready":
			return (
				<span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
					Ready
				</span>
			);
		case "indexing":
			return (
				<span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-500">
					<Loader2 className="h-2.5 w-2.5 animate-spin" />
					Indexing
				</span>
			);
		case "indexed":
			return (
				<span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500">
					<CheckCircle className="h-2.5 w-2.5" />
					Indexed
				</span>
			);
		case "error":
			return (
				<span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500">
					<AlertCircle className="h-2.5 w-2.5" />
					Error
				</span>
			);
	}
}

function ResourceIcon({ type }: { type: Resource["resourceType"] }) {
	if (type === "url")
		return <Globe className="h-4 w-4 shrink-0 text-blue-400" />;
	return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60_000);
	if (diffMins < 1) return "Just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}

export function ResourceList({
	resources,
	selectedId,
	onSelect,
}: {
	resources: Resource[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (resources.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
				No resources yet. Upload a file or add a URL.
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			{resources.map((resource) => (
				<button
					key={resource.id}
					type="button"
					onClick={() => onSelect(resource.id)}
					className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors ${
						selectedId === resource.id ? "bg-accent" : "hover:bg-accent/50"
					}`}
				>
					<ResourceIcon type={resource.resourceType} />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="truncate text-sm font-medium text-foreground">
								{resource.name}
							</span>
						</div>
						<div className="mt-1 flex items-center gap-2">
							<StatusBadge status={resource.status} />
							<span className="text-[10px] text-muted-foreground">
								{formatDate(resource.createdAt)}
							</span>
						</div>
					</div>
				</button>
			))}
		</div>
	);
}
