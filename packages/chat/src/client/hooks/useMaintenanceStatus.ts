import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	type MaintenanceStatus,
	fetchMaintenanceStatus,
	triggerMaintenance,
} from "../lib/api.js";

export function useMaintenanceStatus() {
	const queryClient = useQueryClient();

	const { data: status } = useQuery<MaintenanceStatus>({
		queryKey: ["maintenance-status"],
		queryFn: fetchMaintenanceStatus,
		refetchInterval: (query) =>
			query.state.data?.currentJob?.status === "running" ? 2000 : 15000,
	});

	const trigger = useCallback(async () => {
		await triggerMaintenance();
		queryClient.invalidateQueries({ queryKey: ["maintenance-status"] });
	}, [queryClient]);

	const invalidateGraph = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["graph"] });
	}, [queryClient]);

	return { status: status ?? null, trigger, invalidateGraph };
}
