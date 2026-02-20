import { useCallback, useState } from "react";
import type { CommitEntry } from "../../lib/api";

type ViewMode =
	| { type: "detail"; hash: string }
	| { type: "compare"; fromHash: string; toHash: string }
	| { type: "local-changes" }
	| null;

export function useCommitSelection(commits: CommitEntry[]) {
	const [viewMode, setViewMode] = useState<ViewMode>(null);
	const [compareSelections, setCompareSelections] = useState<string[]>([]);

	const clearCompare = useCallback(() => setCompareSelections([]), []);

	const selectCommit = useCallback((hash: string) => {
		setViewMode({ type: "detail", hash });
		setCompareSelections([]);
	}, []);

	const selectLocalChanges = useCallback(() => {
		setViewMode({ type: "local-changes" });
		setCompareSelections([]);
	}, []);

	const toggleCompareSelection = useCallback((hash: string) => {
		setCompareSelections((prev) => {
			if (prev.includes(hash)) {
				return prev.filter((h) => h !== hash);
			}
			if (prev.length >= 2) {
				return [prev[1], hash];
			}
			return [...prev, hash];
		});
	}, []);

	const confirmCompare = useCallback(() => {
		if (compareSelections.length === 2) {
			const indices = compareSelections.map((h) =>
				commits.findIndex((c) => c.hash === h),
			);
			const [fromHash, toHash] =
				indices[0] > indices[1]
					? [compareSelections[0], compareSelections[1]]
					: [compareSelections[1], compareSelections[0]];
			setViewMode({ type: "compare", fromHash, toHash });
		}
	}, [compareSelections, commits]);

	const compareWithCurrent = useCallback(() => {
		if (viewMode?.type === "detail" && commits.length > 0) {
			const currentHead = commits[0].hash;
			if (currentHead !== viewMode.hash) {
				setViewMode({
					type: "compare",
					fromHash: viewMode.hash,
					toHash: currentHead,
				});
				setCompareSelections([]);
			}
		}
	}, [viewMode, commits]);

	const exitCompare = useCallback(() => {
		setViewMode(null);
		setCompareSelections([]);
	}, []);

	return {
		viewMode,
		compareSelections,
		selectCommit,
		selectLocalChanges,
		toggleCompareSelection,
		confirmCompare,
		compareWithCurrent,
		exitCompare,
	};
}
