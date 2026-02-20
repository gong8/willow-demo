import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	GraphEdge,
	GraphNode,
	WillowGraph,
} from "../../../lib/graph-types";
import { buildSubgraphFromNodes } from "./subgraph-extractors";
import { type SearchToolCall, fetchGraph } from "./types";

const MAX_MERGED_NODES = 80;

export interface WalkStep {
	toolCallId: string;
	action: string;
	positionId: string | null;
	positionContent: string | null;
	pathIds: string[];
	childIds: string[];
	status: "pending" | "settled";
}

function parseWalkResult(result: unknown) {
	try {
		const parsed = typeof result === "string" ? JSON.parse(result) : result;
		const p = parsed as {
			position?: { id: string; content?: string };
			path?: { id: string }[];
			children?: { id: string }[];
		};
		if (!p?.position) return null;
		return {
			positionId: p.position.id,
			positionContent: p.position.content ?? null,
			pathIds: (p.path ?? []).map((n) => n.id),
			childIds: (p.children ?? []).map((n) => n.id),
		};
	} catch {
		return null;
	}
}

function buildStep(
	tc: SearchToolCall,
	walkData: ReturnType<typeof parseWalkResult>,
): WalkStep {
	const action = (tc.args?.action as string) ?? "start";
	return {
		toolCallId: tc.toolCallId,
		action: action === "done" ? "done" : action,
		positionId: walkData?.positionId ?? null,
		positionContent: walkData?.positionContent ?? null,
		pathIds: walkData?.pathIds ?? [],
		childIds: walkData?.childIds ?? [],
		status: tc.result != null ? "settled" : "pending",
	};
}

function collectNodeIds(
	walkData: ReturnType<typeof parseWalkResult>,
	graph: WillowGraph,
	into: Set<string>,
) {
	if (!walkData) return;
	for (const id of [...walkData.pathIds, ...walkData.childIds]) {
		if (graph.nodes[id]) into.add(id);
	}
	if (walkData.positionId && graph.nodes[walkData.positionId]) {
		into.add(walkData.positionId);
	}
}

export interface CumulativeSearchGraphState {
	nodes: GraphNode[];
	edges: GraphEdge[];
	selections: string[];
	actives: string[];
	steps: WalkStep[];
	activeStepIndex: number;
}

export function useCumulativeSearchGraph(
	toolCalls: SearchToolCall[],
): CumulativeSearchGraphState {
	const { data: graph } = useQuery<WillowGraph>({
		queryKey: ["graph"],
		queryFn: fetchGraph,
	});

	const { steps, mergedNodeIds, latestSettledIndex } = useMemo(() => {
		const steps: WalkStep[] = [];
		const mergedNodeIds = new Set<string>();
		let latestSettledIndex = -1;

		if (!graph) return { steps, mergedNodeIds, latestSettledIndex };

		for (const tc of toolCalls) {
			const action = (tc.args?.action as string) ?? "start";
			const hasResult = tc.result != null;
			const walkData =
				action !== "done" && hasResult ? parseWalkResult(tc.result) : null;

			collectNodeIds(walkData, graph, mergedNodeIds);
			steps.push(buildStep(tc, walkData));
			if (hasResult) latestSettledIndex = steps.length - 1;
		}

		// Trim to cap if needed
		if (mergedNodeIds.size > MAX_MERGED_NODES) {
			const keep = [...mergedNodeIds].slice(0, MAX_MERGED_NODES);
			mergedNodeIds.clear();
			for (const id of keep) mergedNodeIds.add(id);
		}

		return { steps, mergedNodeIds, latestSettledIndex };
	}, [graph, toolCalls]);

	const subgraph = useMemo(() => {
		if (!graph || mergedNodeIds.size < 2)
			return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
		return buildSubgraphFromNodes(graph, mergedNodeIds);
	}, [graph, mergedNodeIds]);

	// Find the latest settled step with a position
	let focusId: string | null = null;
	for (let i = steps.length - 1; i >= 0; i--) {
		if (steps[i].positionId && steps[i].status === "settled") {
			focusId = steps[i].positionId;
			break;
		}
	}

	return {
		nodes: subgraph.nodes,
		edges: subgraph.edges,
		selections: focusId ? [focusId] : [],
		actives: [],
		steps,
		activeStepIndex: latestSettledIndex,
	};
}
