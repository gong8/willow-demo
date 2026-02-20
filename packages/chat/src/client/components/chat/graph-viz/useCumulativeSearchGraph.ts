import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	GraphEdge,
	GraphNode,
	WillowGraph,
} from "../../../lib/graph-types.js";
import { buildSubgraphFromNodes } from "./subgraph-extractors.js";
import { type SearchToolCall, fetchGraph } from "./types.js";

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

function parseWalkResult(result: unknown): {
	positionId: string | null;
	positionContent: string | null;
	pathIds: string[];
	childIds: string[];
} {
	const empty = {
		positionId: null,
		positionContent: null,
		pathIds: [] as string[],
		childIds: [] as string[],
	};
	if (result == null) return empty;
	try {
		const parsed = typeof result === "string" ? JSON.parse(result) : result;
		if (!parsed || typeof parsed !== "object") return empty;
		const p = parsed as {
			position?: { id: string; content?: string };
			path?: { id: string }[];
			children?: { id: string }[];
		};
		return {
			positionId: p.position?.id ?? null,
			positionContent: p.position?.content ?? null,
			pathIds: (p.path ?? []).map((n) => n.id),
			childIds: (p.children ?? []).map((n) => n.id),
		};
	} catch {
		return empty;
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
			const isDone = action === "done";

			// Parse walk result for non-done actions that have results
			const walkData = !isDone && hasResult ? parseWalkResult(tc.result) : null;

			if (walkData) {
				for (const id of [...walkData.pathIds, ...walkData.childIds]) {
					if (graph.nodes[id]) mergedNodeIds.add(id);
				}
				if (walkData.positionId && graph.nodes[walkData.positionId]) {
					mergedNodeIds.add(walkData.positionId);
				}
			}

			steps.push({
				toolCallId: tc.toolCallId,
				action: isDone ? "done" : action,
				positionId: walkData?.positionId ?? null,
				positionContent: walkData?.positionContent ?? null,
				pathIds: walkData?.pathIds ?? [],
				childIds: walkData?.childIds ?? [],
				status: hasResult ? "settled" : "pending",
			});

			if (hasResult) latestSettledIndex = steps.length - 1;
		}

		// Cap merged nodes
		if (mergedNodeIds.size > MAX_MERGED_NODES) {
			const arr = [...mergedNodeIds];
			mergedNodeIds.clear();
			for (let i = 0; i < MAX_MERGED_NODES; i++) {
				mergedNodeIds.add(arr[i]);
			}
		}

		return { steps, mergedNodeIds, latestSettledIndex };
	}, [graph, toolCalls]);

	const subgraph = useMemo(() => {
		if (!graph || mergedNodeIds.size < 2)
			return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
		return buildSubgraphFromNodes(graph, mergedNodeIds);
	}, [graph, mergedNodeIds]);

	// Find the last settled step with actual position data (skip "done" steps)
	const displayStep = useMemo(() => {
		for (let i = latestSettledIndex; i >= 0; i--) {
			if (steps[i].positionId) return steps[i];
		}
		return null;
	}, [steps, latestSettledIndex]);

	const selections = displayStep?.positionId ? [displayStep.positionId] : [];
	const actives =
		displayStep?.status === "pending" && displayStep.positionId
			? [displayStep.positionId]
			: [];

	return {
		nodes: subgraph.nodes,
		edges: subgraph.edges,
		selections,
		actives,
		steps,
		activeStepIndex: latestSettledIndex,
	};
}
