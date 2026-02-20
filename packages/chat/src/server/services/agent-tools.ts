export const BLOCKED_BUILTIN_TOOLS: string[] = [
	"Bash",
	"Read",
	"Write",
	"Edit",
	"Glob",
	"Grep",
	"WebFetch",
	"WebSearch",
	"Task",
	"TaskOutput",
	"NotebookEdit",
	"EnterPlanMode",
	"ExitPlanMode",
	"TodoWrite",
	"AskUserQuestion",
	"Skill",
	"TeamCreate",
	"TeamDelete",
	"SendMessage",
	"TaskStop",
	"ToolSearch",
];

const ALL_WILLOW_TOOLS = [
	"mcp__willow__search_nodes",
	"mcp__willow__get_context",
	"mcp__willow__create_node",
	"mcp__willow__update_node",
	"mcp__willow__delete_node",
	"mcp__willow__add_link",
	"mcp__willow__update_link",
	"mcp__willow__delete_link",
	"mcp__willow__walk_graph",
] as const;

type AgentName =
	| "chat"
	| "search"
	| "indexer"
	| "maintenance"
	| "crawler"
	| "resolver";

const FULL_WRITE_TOOLS: readonly string[] = [
	"mcp__willow__search_nodes",
	"mcp__willow__get_context",
	"mcp__willow__create_node",
	"mcp__willow__update_node",
	"mcp__willow__delete_node",
	"mcp__willow__add_link",
	"mcp__willow__update_link",
	"mcp__willow__delete_link",
];

const AGENT_ALLOWED_TOOLS: Record<AgentName, readonly string[]> = {
	chat: [],
	search: ["mcp__willow__walk_graph"],
	indexer: [
		"mcp__willow__search_nodes",
		"mcp__willow__create_node",
		"mcp__willow__update_node",
		"mcp__willow__delete_node",
		"mcp__willow__add_link",
	],
	maintenance: FULL_WRITE_TOOLS,
	crawler: ["mcp__willow__search_nodes", "mcp__willow__get_context"],
	resolver: FULL_WRITE_TOOLS,
};

const CHAT_ALLOWED_BUILTINS = new Set(["WebFetch", "WebSearch"]);

export function getDisallowedTools(agent: AgentName): string[] {
	const allowed = new Set(AGENT_ALLOWED_TOOLS[agent]);
	const blockedWillow = ALL_WILLOW_TOOLS.filter((t) => !allowed.has(t));

	const builtinBlocked =
		agent === "chat"
			? BLOCKED_BUILTIN_TOOLS.filter((t) => !CHAT_ALLOWED_BUILTINS.has(t))
			: BLOCKED_BUILTIN_TOOLS;

	return [...builtinBlocked, ...blockedWillow];
}
