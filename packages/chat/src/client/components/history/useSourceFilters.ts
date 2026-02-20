import { useCallback, useMemo, useState } from "react";
import type { CommitEntry } from "../../lib/api";
import { SOURCE_FILTERS, type SourceFilter } from "./sourceColors";

const ALL_FILTERS = new Set<SourceFilter>(SOURCE_FILTERS.map((f) => f.value));

export function useSourceFilters(commits: CommitEntry[]) {
	const [activeFilters, setActiveFilters] = useState(
		() => new Set(ALL_FILTERS),
	);

	const toggleFilter = useCallback((filter: SourceFilter) => {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(filter)) {
				if (next.size > 1) next.delete(filter);
			} else {
				next.add(filter);
			}
			return next;
		});
	}, []);

	const filtered = useMemo(() => {
		if (activeFilters.size === ALL_FILTERS.size) return commits;
		return commits.filter((c) => activeFilters.has(c.source as SourceFilter));
	}, [commits, activeFilters]);

	return { activeFilters, toggleFilter, filtered };
}
