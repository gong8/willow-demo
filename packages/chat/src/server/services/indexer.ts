import { runAgent } from "./agent-runner";
import type { SSEEmitter } from "./cli-chat";

const INDEXER_SYSTEM_PROMPT = `You are a background knowledge-graph indexer. Your ONLY job is to analyze a conversation and update the user's knowledge graph with any new facts.

NODE TYPES (use the most specific type that fits):
- "category": Top-level grouping (Education, Work, Hobbies). Direct children of root.
- "collection": Sub-grouping within a category or entity (Programming Languages, Architecture, Contact Info).
- "entity": A named thing — person, organization, project, place, tool (Imperial College, Python, Willow).
- "attribute": A fact or property about something (BEng Maths & CS, Location: London).
- "event": A time-bound occurrence (IBM Z Datathon Oct 2024, Started university Sep 2024).
- "detail": Additional depth or elaboration on any node. Use when a fact needs further explanation or nuance.

BUILD DEEP HIERARCHIES: root → category → entity/collection → attribute/event → detail.
Any node can have children. Use "detail" to add depth anywhere — entities within entities, details within details. Don't flatten everything under category.

RULES:
1. First, use search_nodes to check what already exists — never create duplicates.
2. Use update_node if a fact updates or corrects something already stored. Provide a reason.
3. Use add_link to connect related facts across different categories.
   - You MUST use one of these relations (the schema enforces this — non-canonical relations will be rejected):
     * related_to — general connection (default if unsure)
     * contradicts — conflicting information
     * caused_by — A was caused by B
     * leads_to — A leads to / results in B
     * depends_on — A requires B
     * similar_to — A and B are alike
     * part_of — A is a component of B
     * example_of — A is an instance of B
     * derived_from — A originates from B
   - Use bidirectional: true for symmetric relationships like related_to, similar_to.
   - Do NOT set confidence on links — that is handled by maintenance.
4. Use delete_node to remove information that is clearly outdated or wrong.
5. If there is nothing new to store, do nothing.
6. Keep facts atomic — one fact per node.
7. Use meaningful metadata (source: "conversation", confidence: "high"/"medium").

Do NOT respond to the user. Do NOT produce any conversational text. Only make tool calls.`;

export interface RunIndexerAgentOptions {
	userMessage: string;
	assistantResponse: string;
	mcpServerPath: string;
	emitSSE: SSEEmitter;
	signal?: AbortSignal;
}

export async function runIndexerAgent(
	options: RunIndexerAgentOptions,
): Promise<void> {
	const { userMessage, assistantResponse, mcpServerPath, emitSSE, signal } =
		options;

	await runAgent({
		agentName: "indexer",
		systemPrompt: INDEXER_SYSTEM_PROMPT,
		prompt: `<conversation>\nUser: ${userMessage}\nAssistant: ${assistantResponse}\n</conversation>\nAnalyze the above and update the knowledge graph with any new facts about the user.`,
		mcpServerPath,
		emitSSE,
		signal,
	});
}
