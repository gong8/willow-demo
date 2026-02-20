import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type {
	GraphEdge,
	GraphNode,
	WillowGraph,
} from "../../../lib/graph-types.js";
import { buildSubgraphFromNodes } from "./subgraph-extractors.js";

const MAX_MERGED_NODES = 80;
const DIMMED_COLOR = "#d1d5db";
const EXPLORED_COLOR = "#b0b8c4";
const DIMMED_EDGE_COLOR = "#e5e7eb";
const EXPLORED_EDGE_COLOR = "#cbd5e1";

interface SearchToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
}

async function fetchGraph(): Promise<WillowGraph> {
	const res = await fetch("/api/graph");
	return res.json();
}

export interface WalkStep {
	toolCallId: string;
	action: "start" | "down" | "up" | "done";
	positionId: string | null;
	positionContent: string | null;
	pathIds: string[];
	childIds: string[];
	allNodeIds: Set<string>;
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
	setActiveStepIndex: (index: number) => void;
}

export function useCumulativeSearchGraph(
	toolCalls: SearchToolCall[],
): CumulativeSearchGraphState {
	const { data: graph } = useQuery<WillowGraph>({
		queryKey: ["graph"],
		queryFn: fetchGraph,
	});

	const [activeStepIndex, setActiveStepIndex] = useState(-1);
	const prevCountRef = useRef(0);

	// Step 1: Parse each walk_graph tool call into WalkStep and collect all visited node IDs
	const { steps, mergedNodeIds } = useMemo(() => {
		if (!graph)
			return { steps: [] as WalkStep[], mergedNodeIds: new Set<string>() };

		const steps: WalkStep[] = [];
		const mergedNodeIds = new Set<string>();

		for (const tc of toolCalls) {
			const action = (tc.args.action as string) ?? "start";
			const hasResult = tc.result != null;

			// "done" results are plain text ("Search complete."), not JSON
			if (action === "done") {
				steps.push({
					toolCallId: tc.toolCallId,
					action: "done",
					positionId: null,
					positionContent: null,
					pathIds: [],
					childIds: [],
					allNodeIds: new Set<string>(),
					status: hasResult ? "settled" : "pending",
				});
				continue;
			}

			if (hasResult) {
				const { positionId, positionContent, pathIds, childIds } =
					parseWalkResult(tc.result);
				const allNodeIds = new Set<string>();
				for (const id of pathIds) {
					if (graph.nodes[id]) allNodeIds.add(id);
				}
				if (positionId && graph.nodes[positionId]) allNodeIds.add(positionId);
				for (const id of childIds) {
					if (graph.nodes[id]) allNodeIds.add(id);
				}

				for (const id of allNodeIds) mergedNodeIds.add(id);

				steps.push({
					toolCallId: tc.toolCallId,
					action: action as WalkStep["action"],
					positionId,
					positionContent,
					pathIds,
					childIds,
					allNodeIds,
					status: "settled",
				});
			} else {
				// Pending — we know the action but not the result yet
				steps.push({
					toolCallId: tc.toolCallId,
					action: action as WalkStep["action"],
					positionId: null,
					positionContent: null,
					pathIds: [],
					childIds: [],
					allNodeIds: new Set<string>(),
					status: "pending",
				});
			}
		}

		// Cap at MAX_MERGED_NODES
		if (mergedNodeIds.size > MAX_MERGED_NODES) {
			const arr = [...mergedNodeIds];
			mergedNodeIds.clear();
			for (let i = 0; i < MAX_MERGED_NODES && i < arr.length; i++) {
				mergedNodeIds.add(arr[i]);
			}
		}

		return { steps, mergedNodeIds };
	}, [graph, toolCalls]);

	// Step 2: Build the merged graph from all visited nodes
	const mergedGraph = useMemo(() => {
		if (!graph || mergedNodeIds.size < 2)
			return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
		return buildSubgraphFromNodes(graph, mergedNodeIds);
	}, [graph, mergedNodeIds]);

	// Step 3: Determine active step
	// When active step has no position data (done/pending), fall back to last
	// settled step with position data so the graph always has highlights.
	const effectiveIndex =
		activeStepIndex === -1
			? steps.length - 1
			: Math.min(activeStepIndex, steps.length - 1);
	const rawActiveStep =
		effectiveIndex >= 0 ? steps[effectiveIndex] : undefined;

	const activeStep = useMemo(() => {
		if (rawActiveStep?.positionId) return rawActiveStep;
		// Fall back: scan backwards for the last step with position data
		for (let i = effectiveIndex - 1; i >= 0; i--) {
			if (steps[i].positionId && steps[i].status === "settled") {
				return steps[i];
			}
		}
		return rawActiveStep;
	}, [rawActiveStep, steps, effectiveIndex]);

	// Step 4: Compute explored (prior steps) node IDs — everything seen before activeStep
	const priorNodeIds = useMemo(() => {
		const prior = new Set<string>();
		if (!activeStep) return prior;
		for (const s of steps) {
			if (s === activeStep) break;
			if (s.status === "settled") {
				for (const id of s.allNodeIds) prior.add(id);
			}
		}
		return prior;
	}, [steps, activeStep]);

	// Step 5: Compute display state — selected, active, explored, dimmed
	const { displayNodes, displayEdges, selections, actives } = useMemo(() => {
		if (!activeStep) {
			return {
				displayNodes: mergedGraph.nodes,
				displayEdges: mergedGraph.edges,
				selections: [] as string[],
				actives: [] as string[],
			};
		}

		const selectedIds = new Set<string>();
		const activeIds = new Set<string>();

		if (activeStep.positionId) selectedIds.add(activeStep.positionId);
		for (const id of activeStep.pathIds) activeIds.add(id);
		for (const id of activeStep.childIds) {
			if (mergedNodeIds.has(id)) activeIds.add(id);
		}
		// Position is also active
		if (activeStep.positionId) activeIds.add(activeStep.positionId);

		const displayNodes: GraphNode[] = mergedGraph.nodes.map((n) => {
			if (selectedIds.has(n.id)) return n;
			if (activeIds.has(n.id)) return n;
			if (priorNodeIds.has(n.id)) return { ...n, fill: EXPLORED_COLOR };
			return { ...n, fill: DIMMED_COLOR };
		});

		const displayEdges: GraphEdge[] = mergedGraph.edges.map((e) => {
			if (activeIds.has(e.source) && activeIds.has(e.target)) return e;
			if (priorNodeIds.has(e.source) && priorNodeIds.has(e.target)) {
				return { ...e, fill: EXPLORED_EDGE_COLOR };
			}
			return { ...e, fill: DIMMED_EDGE_COLOR };
		});

		const selections = [...selectedIds];

		// Pulse the position node when step is pending
		const actives: string[] =
			activeStep.status === "pending" && activeStep.positionId
				? [activeStep.positionId]
				: [];

		return { displayNodes, displayEdges, selections, actives };
	}, [mergedGraph, activeStep, priorNodeIds, mergedNodeIds]);

	// Auto-follow latest step when new tool calls arrive
	if (toolCalls.length !== prevCountRef.current) {
		prevCountRef.current = toolCalls.length;
		if (activeStepIndex !== -1) {
			setActiveStepIndex(-1);
		}
	}

	return {
		nodes: displayNodes,
		edges: displayEdges,
		selections,
		actives,
		steps,
		activeStepIndex: effectiveIndex,
		setActiveStepIndex,
	};
}
