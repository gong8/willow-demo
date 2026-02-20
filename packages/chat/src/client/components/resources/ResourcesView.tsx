import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import {
	type Resource,
	createUrlResource,
	fetchResources,
	uploadResource,
} from "../../lib/api.js";
import { ResourceDetailPanel } from "./ResourceDetailPanel.js";
import { ResourceList } from "./ResourceList.js";
import { ResourceUploadDialog } from "./ResourceUploadDialog.js";

export function ResourcesView() {
	const queryClient = useQueryClient();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [showUpload, setShowUpload] = useState(false);

	const { data: resources = [] } = useQuery<Resource[]>({
		queryKey: ["resources"],
		queryFn: fetchResources,
		refetchInterval: 5000,
	});

	const selectedResource = resources.find((r) => r.id === selectedId) ?? null;

	const handleUploadFile = useCallback(
		async (file: File) => {
			const res = await uploadResource(file);
			queryClient.invalidateQueries({ queryKey: ["resources"] });
			setSelectedId(res.id);
		},
		[queryClient],
	);

	const handleAddUrl = useCallback(
		async (url: string) => {
			const res = await createUrlResource(url);
			queryClient.invalidateQueries({ queryKey: ["resources"] });
			setSelectedId(res.id);
		},
		[queryClient],
	);

	const handleDeleted = useCallback(() => {
		setSelectedId(null);
	}, []);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Toolbar */}
			<div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<FolderOpen className="h-4 w-4" />
					<span className="font-medium">Resources</span>
					<span className="text-xs">({resources.length})</span>
				</div>
				<button
					type="button"
					onClick={() => setShowUpload(true)}
					className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
				>
					<Plus className="h-3.5 w-3.5" />
					Add Resource
				</button>
			</div>

			{/* Main content */}
			{resources.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
					<FolderOpen className="h-12 w-12 opacity-30" />
					<p className="text-sm">No resources yet</p>
					<button
						type="button"
						onClick={() => setShowUpload(true)}
						className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
					>
						<Plus className="h-4 w-4" />
						Add your first resource
					</button>
				</div>
			) : (
				<div className="flex flex-1 overflow-hidden">
					{/* Left panel: resource list */}
					<div className="flex w-80 flex-col border-r border-border">
						<ResourceList
							resources={resources}
							selectedId={selectedId}
							onSelect={setSelectedId}
						/>
					</div>

					{/* Right panel: detail */}
					{selectedResource ? (
						<ResourceDetailPanel
							resource={selectedResource}
							onDeleted={handleDeleted}
						/>
					) : (
						<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
							Select a resource to view details
						</div>
					)}
				</div>
			)}

			{/* Upload dialog */}
			{showUpload && (
				<ResourceUploadDialog
					onUploadFile={handleUploadFile}
					onAddUrl={handleAddUrl}
					onClose={() => setShowUpload(false)}
				/>
			)}
		</div>
	);
}
