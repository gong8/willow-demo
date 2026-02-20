import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	ExternalLink,
	FileText,
	Globe,
	Loader2,
	Play,
	Trash2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
	type Resource,
	deleteResource,
	fetchResourceContent,
	indexResourceStream,
} from "../../lib/api.js";

interface IndexingToolCall {
	toolCallId: string;
	toolName: string;
	args?: Record<string, unknown>;
}

function formatSize(bytes: number | null): string {
	if (bytes == null) return "Unknown size";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResourceDetailPanel({
	resource,
	onDeleted,
}: {
	resource: Resource;
	onDeleted: () => void;
}) {
	const queryClient = useQueryClient();
	const [isIndexing, setIsIndexing] = useState(false);
	const [indexContext, setIndexContext] = useState(resource.indexContext ?? "");
	const [toolCalls, setToolCalls] = useState<IndexingToolCall[]>([]);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const toolCallsEndRef = useRef<HTMLDivElement>(null);

	const { data: contentData } = useQuery({
		queryKey: ["resource-content", resource.id],
		queryFn: () => fetchResourceContent(resource.id),
		enabled: resource.status !== "pending" && resource.status !== "extracting",
	});

	const handleIndex = useCallback(async () => {
		setIsIndexing(true);
		setToolCalls([]);

		try {
			await indexResourceStream(
				resource.id,
				indexContext || undefined,
				(event, data) => {
					if (event === "tool_call_start") {
						try {
							const parsed = JSON.parse(data);
							setToolCalls((prev) => [
								...prev,
								{
									toolCallId: parsed.toolCallId,
									toolName: parsed.toolName,
								},
							]);
						} catch {
							/* ignore */
						}
					} else if (event === "tool_call_args") {
						try {
							const parsed = JSON.parse(data);
							setToolCalls((prev) =>
								prev.map((tc) =>
									tc.toolCallId === parsed.toolCallId
										? { ...tc, args: parsed.args }
										: tc,
								),
							);
						} catch {
							/* ignore */
						}
					}
				},
			);
		} catch {
			// Error handled by status update
		} finally {
			setIsIndexing(false);
			queryClient.invalidateQueries({ queryKey: ["resources"] });
		}
	}, [resource.id, indexContext, queryClient]);

	const handleDelete = useCallback(async () => {
		await deleteResource(resource.id);
		queryClient.invalidateQueries({ queryKey: ["resources"] });
		onDeleted();
	}, [resource.id, queryClient, onDeleted]);

	const previewText = contentData?.text
		? contentData.text.slice(0, 500) +
			(contentData.text.length > 500 ? "..." : "")
		: null;

	const canIndex =
		resource.status === "ready" ||
		resource.status === "indexed" ||
		resource.status === "error";

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{/* Header */}
			<div className="border-b border-border px-6 py-4">
				<div className="flex items-start gap-3">
					{resource.resourceType === "url" ? (
						<Globe className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
					) : (
						<FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
					)}
					<div className="min-w-0 flex-1">
						<h2 className="text-base font-semibold text-foreground">
							{resource.name}
						</h2>
						<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span>{resource.resourceType.toUpperCase()}</span>
							{resource.fileSize != null && (
								<span>{formatSize(resource.fileSize)}</span>
							)}
							<span>
								Added {new Date(resource.createdAt).toLocaleDateString()}
							</span>
						</div>
					</div>
				</div>

				{resource.sourceUrl && (
					<a
						href={resource.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
					>
						<ExternalLink className="h-3 w-3" />
						{resource.sourceUrl}
					</a>
				)}

				{resource.status === "error" && resource.errorMessage && (
					<div className="mt-3 flex items-start gap-2 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
						<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
						{resource.errorMessage}
					</div>
				)}
			</div>

			{/* Text preview */}
			{previewText && (
				<div className="border-b border-border px-6 py-4">
					<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Content Preview
					</h3>
					<p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
						{previewText}
					</p>
				</div>
			)}

			{/* Indexing section */}
			{canIndex && (
				<div className="border-b border-border px-6 py-4">
					<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Index to Knowledge Graph
					</h3>
					<input
						type="text"
						value={indexContext}
						onChange={(e) => setIndexContext(e.target.value)}
						placeholder="e.g., this is my employment contract"
						className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
						disabled={isIndexing}
					/>
					<button
						type="button"
						onClick={handleIndex}
						disabled={isIndexing}
						className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
					>
						{isIndexing ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" />
								Indexing...
							</>
						) : (
							<>
								<Play className="h-4 w-4" />
								{resource.status === "indexed"
									? "Re-index"
									: resource.status === "error"
										? "Retry Indexing"
										: "Start Indexing"}
							</>
						)}
					</button>
				</div>
			)}

			{/* Indexing tool calls */}
			{toolCalls.length > 0 && (
				<div className="border-b border-border px-6 py-4">
					<h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Indexing Activity
					</h3>
					<div className="max-h-60 space-y-1 overflow-y-auto rounded-md bg-muted/50 p-3">
						{toolCalls.map((tc) => (
							<div
								key={tc.toolCallId}
								className="flex items-start gap-2 text-xs"
							>
								<span className="shrink-0 font-mono text-blue-400">
									{tc.toolName.replace("mcp__willow__", "")}
								</span>
								{tc.args && (
									<span className="truncate text-muted-foreground">
										{JSON.stringify(tc.args).slice(0, 100)}
									</span>
								)}
							</div>
						))}
						<div ref={toolCallsEndRef} />
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="px-6 py-4">
				{confirmDelete ? (
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground">
							Delete this resource?
						</span>
						<button
							type="button"
							onClick={handleDelete}
							className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
						>
							Confirm
						</button>
						<button
							type="button"
							onClick={() => setConfirmDelete(false)}
							className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
						>
							Cancel
						</button>
					</div>
				) : (
					<button
						type="button"
						onClick={() => setConfirmDelete(true)}
						className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-500/50 hover:text-red-400"
					>
						<Trash2 className="h-3 w-3" />
						Delete Resource
					</button>
				)}
			</div>
		</div>
	);
}
