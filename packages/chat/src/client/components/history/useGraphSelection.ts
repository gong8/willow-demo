import { useCallback, useState } from "react";

export function useGraphSelection() {
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selections, setSelections] = useState<string[]>([]);

	const handleNodeClick = useCallback((node: { id: string }) => {
		setSelectedNodeId(node.id);
		setSelections([node.id]);
	}, []);

	const handleCanvasClick = useCallback(() => {
		setSelectedNodeId(null);
		setSelections([]);
	}, []);

	return { selectedNodeId, selections, handleNodeClick, handleCanvasClick };
}
