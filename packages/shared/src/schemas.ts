import { z } from "zod";

export const CANONICAL_RELATIONS = [
	"related_to",
	"contradicts",
	"caused_by",
	"leads_to",
	"depends_on",
	"similar_to",
	"part_of",
	"example_of",
	"derived_from",
] as const;

export type CanonicalRelation = (typeof CANONICAL_RELATIONS)[number];

const relationEnum = z.enum(CANONICAL_RELATIONS);
const confidenceEnum = z.enum(["low", "medium", "high"]);
const optionalMetadata = z.record(z.string()).optional();
const nodeId = z.string().describe("ID of the node");
const linkId = z.string().describe("ID of the link");

const temporalMetadataSchema = z
	.object({
		validFrom: z.string().optional(),
		validUntil: z.string().optional(),
		label: z.string().optional(),
	})
	.optional();

const linkFieldsSchema = z.object({
	relation: relationEnum.describe(
		"Relationship type. Must be one of: related_to, contradicts, caused_by, leads_to, depends_on, similar_to, part_of, example_of, derived_from",
	),
	bidirectional: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			"If true, the link can be followed from either endpoint. Use for symmetric relations like 'related_to', 'similar_to'.",
		),
	confidence: confidenceEnum
		.optional()
		.describe("Confidence level for this link"),
});

const createNodeSchema = z.object({
	parentId: z.string().describe("ID of the parent node"),
	nodeType: z
		.enum(["category", "collection", "entity", "attribute", "event", "detail"])
		.describe(
			"Node type: 'category' for top-level grouping, 'collection' for sub-groups, 'entity' for named things, 'attribute' for facts/properties, 'event' for time-bound occurrences, 'detail' for additional depth/elaboration on any node",
		),
	content: z.string().describe("The content/fact to store"),
	metadata: optionalMetadata.describe("Optional key-value metadata"),
	temporal: temporalMetadataSchema.describe(
		"Optional temporal bounds for time-sensitive facts",
	),
});

const updateNodeSchema = z.object({
	nodeId: nodeId.describe("ID of the node to update"),
	content: z
		.string()
		.optional()
		.describe("New content (old content is preserved in history)"),
	metadata: optionalMetadata.describe("New metadata (replaces existing)"),
	temporal: temporalMetadataSchema.describe("Updated temporal metadata"),
	reason: z
		.string()
		.optional()
		.describe("Why the content was changed (stored in history)"),
});

const addLinkSchema = z.object({
	fromNode: z.string().describe("Source node ID"),
	toNode: z.string().describe("Target node ID"),
	...linkFieldsSchema.shape,
});

const searchNodesSchema = z.object({
	query: z
		.string()
		.describe("Search query (matches against content and metadata)"),
	maxResults: z
		.number()
		.int()
		.min(1)
		.max(50)
		.optional()
		.default(10)
		.describe("Maximum number of results to return"),
});

const getContextSchema = z.object({
	nodeId: nodeId.describe("ID of the node to get context for"),
	depth: z
		.number()
		.int()
		.min(0)
		.max(10)
		.optional()
		.default(2)
		.describe("How many levels of descendants to include"),
});

const deleteNodeSchema = z.object({
	nodeId: nodeId.describe(
		"ID of the node to delete (cascades to all descendants)",
	),
});

const updateLinkSchema = z.object({
	linkId: linkId.describe("ID of the link to update"),
	...linkFieldsSchema.partial().shape,
});

const deleteLinkSchema = z.object({
	linkId: linkId.describe("ID of the link to delete"),
});

const walkGraphSchema = z.object({
	action: z
		.enum(["start", "down", "up", "follow_link", "done"])
		.describe(
			"Navigation action: 'start' begins at root, 'down' enters a child, 'up' backtracks to parent, 'follow_link' follows a cross-cutting link to the other endpoint, 'done' ends the search",
		),
	nodeId: nodeId
		.optional()
		.describe(
			"Target child node ID for 'down', current node ID for 'up' and 'follow_link'. Not needed for 'start' or 'done'.",
		),
	linkId: linkId
		.optional()
		.describe("Link ID to follow. Required for 'follow_link' action."),
});

export const schemas = {
	createNode: createNodeSchema,
	updateNode: updateNodeSchema,
	addLink: addLinkSchema,
	updateLink: updateLinkSchema,
	deleteLink: deleteLinkSchema,
	searchNodes: searchNodesSchema,
	getContext: getContextSchema,
	deleteNode: deleteNodeSchema,
	walkGraph: walkGraphSchema,
};

type Schemas = typeof schemas;
export type CreateNodeInput = z.infer<Schemas["createNode"]>;
export type UpdateNodeInput = z.infer<Schemas["updateNode"]>;
export type AddLinkInput = z.infer<Schemas["addLink"]>;
export type UpdateLinkInput = z.infer<Schemas["updateLink"]>;
export type SearchNodesInput = z.infer<Schemas["searchNodes"]>;
export type GetContextInput = z.infer<Schemas["getContext"]>;
export type DeleteNodeInput = z.infer<Schemas["deleteNode"]>;
export type DeleteLinkInput = z.infer<Schemas["deleteLink"]>;
export type WalkGraphInput = z.infer<Schemas["walkGraph"]>;
