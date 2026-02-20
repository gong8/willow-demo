# Maybe: Expressive Link Relations

**Status:** Maybe — revisit if the 9 canonical relations feel too limiting in practice.

## Problem

The current strict `z.enum()` forces all links into 9 canonical relations. This prevents the 35+ proliferation problem but may over-compress semantics — e.g. "works_at", "lives_in", "studied_at" all collapse to `related_to`.

## Idea: Two-tier relations

Keep the canonical enum as the **primary relation** (required), but add an optional freeform **qualifier** for extra context:

```ts
const addLinkSchema = z.object({
  fromNode: z.string(),
  toNode: z.string(),
  relation: z.enum(CANONICAL_RELATIONS),       // required, strict
  qualifier: z.string().max(40).optional(),     // optional, freeform
  // ...
});
```

Example links:
- `relation: "part_of"`, `qualifier: "works_at"` — "Alice" → "Acme Corp"
- `relation: "derived_from"`, `qualifier: "studied_at"` — "ML Knowledge" → "Imperial College"
- `relation: "related_to"` (no qualifier) — generic connection

## Why this might work

- Sidebar groups by canonical relation (clean, bounded)
- Qualifier shows on hover/detail view for extra semantics
- Indexer can skip qualifier if unsure — no pressure to invent names
- Graph queries filter on canonical relation, qualifier is just metadata

## Why it might not

- Claude might still over-specify qualifiers, creating visual noise
- Two fields for one concept adds complexity for little gain
- The tree structure + node content already carry the specifics

## If we do it

1. Add `qualifier: z.string().max(40).optional()` to `addLinkSchema` and `updateLinkSchema`
2. Pass through to Rust core (store as-is, like relation today)
3. Show qualifier in graph tooltip / edge detail panel
4. Sidebar still groups by canonical relation only
5. Update indexer prompt: "qualifier is optional — only use when the canonical relation loses important nuance"
