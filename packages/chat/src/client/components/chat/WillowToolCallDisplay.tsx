import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { ToolCallDisplay } from "./ToolCallDisplay.js";
import { WillowToolViz } from "./graph-viz/WillowToolViz.js";

export function WillowToolCallDisplay(props: ToolCallMessagePartProps) {
	const isWillow = props.toolName.startsWith("mcp__willow__");

	return (
		<>
			<ToolCallDisplay {...props} />
			{isWillow && (
				<WillowToolViz
					toolName={props.toolName}
					args={props.args}
					result={props.result}
					isError={props.isError}
				/>
			)}
		</>
	);
}
