import { z } from "zod";

const temporalMetadataSchema = z
	.object({
		validFrom: z.string().optional(),
		validUntil: z.string().optional(),
		label: z.string().optional(),
	})
	.optional();

const createNodeSchema = z.object({
	parentId: z.string().describe("ID of the parent node"),
	nodeType: z
		.enum(["category", "collection", "entity", "attribute", "event", "detail"])
		.describe("Node type: 'category' for top-level grouping, 'collection' for sub-groups, 'entity' for named things, 'attribute' for facts/properties, 'event' for time-bound occurrences, 'detail' for additional depth/elaboration on any node"),
	content: z.string().describe("The content/fact to store"),
	metadata: z
		.record(z.string())
		.optional()
		.describe("Optional key-value metadata"),
	temporal: temporalMetadataSchema.describe(
		"Optional temporal bounds for time-sensitive facts",
	),
});

const updateNodeSchema = z.object({
	nodeId: z.string().describe("ID of the node to update"),
	content: z
		.string()
		.optional()
		.describe("New content (old content is preserved in history)"),
	metadata: z
		.record(z.string())
		.optional()
		.describe("New metadata (replaces existing)"),
	temporal: temporalMetadataSchema.describe("Updated temporal metadata"),
	reason: z
		.string()
		.optional()
		.describe("Why the content was changed (stored in history)"),
});

const addLinkSchema = z.object({
	fromNode: z.string().describe("Source node ID"),
	toNode: z.string().describe("Target node ID"),
	relation: z
		.string()
		.describe(
			"Relationship label (e.g. 'related_to', 'contradicts', 'caused_by')",
		),
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
	nodeId: z.string().describe("ID of the node to get context for"),
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
	nodeId: z
		.string()
		.describe("ID of the node to delete (cascades to all descendants)"),
});

export const schemas = {
	createNode: createNodeSchema,
	updateNode: updateNodeSchema,
	addLink: addLinkSchema,
	searchNodes: searchNodesSchema,
	getContext: getContextSchema,
	deleteNode: deleteNodeSchema,
};

export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
export type AddLinkInput = z.infer<typeof addLinkSchema>;
export type SearchNodesInput = z.infer<typeof searchNodesSchema>;
export type GetContextInput = z.infer<typeof getContextSchema>;
export type DeleteNodeInput = z.infer<typeof deleteNodeSchema>;
