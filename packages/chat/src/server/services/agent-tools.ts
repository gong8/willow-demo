/**
 * Centralized agent tool permission registry.
 *
 * Each agent declares ONLY the willow MCP tools it may use (allowlist).
 * The disallowed list is computed automatically: BLOCKED_BUILTIN_TOOLS + any
 * willow tools NOT in the agent's allowlist.
 */

/** Claude CLI built-in tools that no agent should ever use. */
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

/** Every willow MCP tool — single source of truth. */
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

/** Allowlist: each agent declares ONLY the willow tools it may use. */
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
	maintenance: [
		"mcp__willow__search_nodes",
		"mcp__willow__get_context",
		"mcp__willow__create_node",
		"mcp__willow__update_node",
		"mcp__willow__delete_node",
		"mcp__willow__add_link",
		"mcp__willow__update_link",
		"mcp__willow__delete_link",
	],
	crawler: ["mcp__willow__search_nodes", "mcp__willow__get_context"],
	resolver: [
		"mcp__willow__search_nodes",
		"mcp__willow__get_context",
		"mcp__willow__create_node",
		"mcp__willow__update_node",
		"mcp__willow__delete_node",
		"mcp__willow__add_link",
		"mcp__willow__update_link",
		"mcp__willow__delete_link",
	],
};

/**
 * Returns the full disallowed tools list for an agent:
 * BLOCKED_BUILTIN_TOOLS + any willow tools NOT in the agent's allowlist.
 */
export function getDisallowedTools(agent: AgentName): string[] {
	const allowed = new Set(AGENT_ALLOWED_TOOLS[agent]);
	const blockedWillow = ALL_WILLOW_TOOLS.filter((t) => !allowed.has(t));
	return [...BLOCKED_BUILTIN_TOOLS, ...blockedWillow];
}
