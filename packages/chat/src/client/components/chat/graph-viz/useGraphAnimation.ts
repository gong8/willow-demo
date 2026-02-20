import { useEffect, useRef, useState } from "react";
import type { AnimationPhase } from "./types.js";

const PHASE_INTERVAL_MS = 150;

const EMPTY_SET = new Set<string>();

interface AnimationState {
	activeNodeIds: Set<string>;
	activeEdgeIds: Set<string>;
	selectedNodeIds: Set<string>;
}

export function useGraphAnimation(phases: AnimationPhase[]): AnimationState {
	const [phaseIndex, setPhaseIndex] = useState(0);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (phases.length === 0) return;

		setPhaseIndex(0);
		timerRef.current = setInterval(() => {
			setPhaseIndex((prev) => {
				if (prev >= phases.length - 1) {
					if (timerRef.current) clearInterval(timerRef.current);
					return prev;
				}
				return prev + 1;
			});
		}, PHASE_INTERVAL_MS);

		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, [phases]);

	if (phases.length === 0) {
		return {
			activeNodeIds: EMPTY_SET,
			activeEdgeIds: EMPTY_SET,
			selectedNodeIds: EMPTY_SET,
		};
	}

	const current = phases[Math.min(phaseIndex, phases.length - 1)];
	return {
		activeNodeIds: new Set(current.activeNodeIds),
		activeEdgeIds: new Set(current.activeEdgeIds),
		selectedNodeIds: new Set(current.selectedNodeIds),
	};
}
