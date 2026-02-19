import { useQuery } from "@tanstack/react-query";
import { type IndexerStatus, fetchIndexerStatus } from "../lib/api.js";

const ACTIVE_INTERVAL = 1500;
const IDLE_INTERVAL = 8000;

export function useIndexerStatus(conversationId: string): IndexerStatus {
	const { data } = useQuery<IndexerStatus>({
		queryKey: ["indexer-status", conversationId],
		queryFn: () => fetchIndexerStatus(conversationId),
		refetchInterval: (query) => {
			const d = query.state.data;
			return d?.active ? ACTIVE_INTERVAL : IDLE_INTERVAL;
		},
	});

	return data ?? { active: false, status: null, toolCalls: [] };
}
