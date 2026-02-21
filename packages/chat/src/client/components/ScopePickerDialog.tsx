import { ChevronRight, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type TreeNode, fetchNodeChildren } from "../lib/api.js";

interface TreeNodeState extends TreeNode {
	children?: TreeNodeState[];
	expanded: boolean;
	loading: boolean;
}

function ScopeTreeNode({
	node,
	depth,
	selectedId,
	onSelect,
	onToggle,
}: {
	node: TreeNodeState;
	depth: number;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onToggle: (id: string) => void;
}) {
	const hasChildren = node.childCount > 0;
	const isSelected = selectedId === node.id;

	return (
		<div>
			<div
				className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
					isSelected
						? "bg-primary/10 text-primary"
						: "text-foreground hover:bg-accent/50"
				}`}
				style={{ paddingLeft: `${depth * 16 + 8}px` }}
				onClick={() => onSelect(node.id)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onSelect(node.id);
					}
				}}
				role="button"
				tabIndex={0}
			>
				{hasChildren ? (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onToggle(node.id);
						}}
						className="shrink-0 rounded p-0.5 hover:bg-accent"
					>
						{node.loading ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						) : (
							<ChevronRight
								className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
									node.expanded ? "rotate-90" : ""
								}`}
							/>
						)}
					</button>
				) : (
					<span className="w-[22px] shrink-0" />
				)}

				<input
					type="radio"
					name="scope"
					checked={isSelected}
					onChange={() => onSelect(node.id)}
					className="shrink-0 accent-primary"
					onClick={(e) => e.stopPropagation()}
				/>

				<span className="flex-1 truncate">{node.content}</span>

				<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
					{node.nodeType}
				</span>

				{hasChildren && (
					<span className="shrink-0 text-[10px] text-muted-foreground">
						({node.childCount})
					</span>
				)}
			</div>

			{node.expanded && node.children && (
				<div>
					{node.children.map((child) => (
						<ScopeTreeNode
							key={child.id}
							node={child}
							depth={depth + 1}
							selectedId={selectedId}
							onSelect={onSelect}
							onToggle={onToggle}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function ScopePickerDialog({
	onSelect,
	onClose,
}: {
	onSelect: (scopeNodeId: string | null) => void;
	onClose: () => void;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [rootChildren, setRootChildren] = useState<TreeNodeState[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		fetchNodeChildren("root")
			.then((children) =>
				setRootChildren(
					children.map((c) => ({
						...c,
						expanded: false,
						loading: false,
					})),
				),
			)
			.catch(() => setRootChildren([]))
			.finally(() => setLoading(false));
	}, []);

	const updateNode = useCallback(
		(
			nodes: TreeNodeState[],
			id: string,
			updater: (node: TreeNodeState) => TreeNodeState,
		): TreeNodeState[] =>
			nodes.map((node) => {
				if (node.id === id) return updater(node);
				if (node.children) {
					return {
						...node,
						children: updateNode(node.children, id, updater),
					};
				}
				return node;
			}),
		[],
	);

	const handleToggle = useCallback(
		async (id: string) => {
			// Find if already expanded — toggle off
			const find = (nodes: TreeNodeState[]): TreeNodeState | undefined => {
				for (const n of nodes) {
					if (n.id === id) return n;
					if (n.children) {
						const found = find(n.children);
						if (found) return found;
					}
				}
				return undefined;
			};

			const node = find(rootChildren);
			if (!node) return;

			if (node.expanded) {
				setRootChildren((prev) =>
					updateNode(prev, id, (n) => ({ ...n, expanded: false })),
				);
				return;
			}

			if (node.children) {
				setRootChildren((prev) =>
					updateNode(prev, id, (n) => ({ ...n, expanded: true })),
				);
				return;
			}

			// Lazy load children
			setRootChildren((prev) =>
				updateNode(prev, id, (n) => ({ ...n, loading: true })),
			);

			try {
				const children = await fetchNodeChildren(id);
				setRootChildren((prev) =>
					updateNode(prev, id, (n) => ({
						...n,
						loading: false,
						expanded: true,
						children: children.map((c) => ({
							...c,
							expanded: false,
							loading: false,
						})),
					})),
				);
			} catch {
				setRootChildren((prev) =>
					updateNode(prev, id, (n) => ({ ...n, loading: false })),
				);
			}
		},
		[rootChildren, updateNode],
	);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="mx-4 w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h3 className="text-sm font-semibold text-foreground">
						Choose context scope
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* Content */}
				<div className="max-h-80 overflow-y-auto p-3">
					{/* Entire graph option */}
					<div
						className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
							selectedId === null
								? "bg-primary/10 text-primary"
								: "text-foreground hover:bg-accent/50"
						}`}
						onClick={() => setSelectedId(null)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								setSelectedId(null);
							}
						}}
						role="button"
						tabIndex={0}
					>
						<span className="w-[22px] shrink-0" />
						<input
							type="radio"
							name="scope"
							checked={selectedId === null}
							onChange={() => setSelectedId(null)}
							className="shrink-0 accent-primary"
							onClick={(e) => e.stopPropagation()}
						/>
						<span className="flex-1 font-medium">Entire graph</span>
					</div>

					{/* Separator */}
					{rootChildren.length > 0 && (
						<div className="my-2 border-t border-border" />
					)}

					{/* Tree browser */}
					{loading ? (
						<div className="flex items-center justify-center py-6">
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						</div>
					) : (
						rootChildren.map((node) => (
							<ScopeTreeNode
								key={node.id}
								node={node}
								depth={0}
								selectedId={selectedId}
								onSelect={setSelectedId}
								onToggle={handleToggle}
							/>
						))
					)}

					{!loading && rootChildren.length === 0 && (
						<p className="py-4 text-center text-xs text-muted-foreground">
							No nodes in the knowledge graph yet
						</p>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => onSelect(selectedId)}
						className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
					>
						Start Chat
					</button>
				</div>
			</div>
		</div>
	);
}
