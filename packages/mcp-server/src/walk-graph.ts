import type { JsGraphStore } from "@willow/core";

type ToolResult = {
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

function json(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function text(msg: string, isError?: boolean): ToolResult {
	const result: ToolResult = { content: [{ type: "text", text: msg }] };
	if (isError) result.isError = true;
	return result;
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}...` : s;
}

function formatWalkView(store: JsGraphStore, targetId: string): ToolResult {
	const ctx = store.getContext(targetId, 2);
	const position = {
		id: ctx.node.id,
		content: ctx.node.content,
		type: ctx.node.nodeType,
	};

	const path = [
		...ctx.ancestors.reverse().map((n) => ({
			id: n.id,
			content: n.content,
			type: n.nodeType,
		})),
		position,
	];

	const children = ctx.descendants
		.filter((n) => n.parentId === targetId)
		.map((n) => ({
			id: n.id,
			content: n.content,
			type: n.nodeType,
			childCount: n.children.length,
			children: ctx.descendants
				.filter((gc) => gc.parentId === n.id)
				.map((gc) => ({
					id: gc.id,
					content: truncate(gc.content, 80),
					type: gc.nodeType,
					childCount: gc.children.length,
				})),
		}));

	const links = ctx.links
		.filter((l) => l.fromNode === targetId || l.toNode === targetId)
		.map((l) => {
			const isOutgoing = l.fromNode === targetId;
			const otherNodeId = isOutgoing ? l.toNode : l.fromNode;
			let targetContent = otherNodeId;
			try {
				targetContent = truncate(
					store.getContext(otherNodeId, 0).node.content,
					60,
				);
			} catch {
				// Node may not exist
			}
			return {
				linkId: l.id,
				relation: l.relation,
				targetNodeId: otherNodeId,
				targetContent,
				direction: isOutgoing ? "outgoing" : "incoming",
				bidirectional: l.bidirectional,
				canFollow: isOutgoing || l.bidirectional,
			};
		});

	return json({ position, path, children, links });
}

export function handleWalkAction(
	store: JsGraphStore,
	action: string,
	nodeId?: string,
	linkId?: string,
): ToolResult {
	if (action === "start") return formatWalkView(store, "root");
	if (action === "done") return text("Search complete.");

	if (action === "down") {
		if (!nodeId)
			return text("Error: nodeId is required for 'down' action.", true);
		return formatWalkView(store, nodeId);
	}

	if (action === "up") {
		if (!nodeId)
			return text("Error: nodeId is required for 'up' action.", true);
		const ctx = store.getContext(nodeId, 0);
		const parentId = ctx.node.parentId;
		if (!parentId) return text("Already at root, cannot go up.");
		return formatWalkView(store, parentId);
	}

	if (action === "follow_link") {
		if (!nodeId || !linkId) {
			return text(
				"Error: both nodeId and linkId are required for 'follow_link' action.",
				true,
			);
		}
		const ctx = store.getContext(nodeId, 0);
		const link = ctx.links.find((l) => l.id === linkId);
		if (!link) {
			return text(`Error: link ${linkId} not found on node ${nodeId}.`, true);
		}
		const isOutgoing = link.fromNode === nodeId;
		if (!isOutgoing && !link.bidirectional) {
			return text(
				`Error: link ${linkId} is directed and cannot be followed from node ${nodeId} (it is incoming and not bidirectional).`,
				true,
			);
		}
		const targetNodeId = isOutgoing ? link.toNode : link.fromNode;
		return formatWalkView(store, targetNodeId);
	}

	return text(`Unknown action: ${action}`, true);
}
