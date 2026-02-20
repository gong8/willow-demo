use crate::model;
use crate::napi_dto::*;
use crate::search;
use crate::vcs;

fn parse_rfc3339(s: &Option<String>) -> Option<chrono::DateTime<chrono::Utc>> {
    s.as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
}

pub fn js_temporal_to_model(t: &JsTemporalMetadata) -> model::TemporalMetadata {
    model::TemporalMetadata {
        valid_from: parse_rfc3339(&t.valid_from),
        valid_until: parse_rfc3339(&t.valid_until),
        label: t.label.clone(),
    }
}

pub fn convert_vec<'a, T, U>(items: &'a [T]) -> Vec<U>
where
    U: From<&'a T>,
{
    items.iter().map(U::from).collect()
}

// ---- From impls: domain -> JS ----

impl From<&model::Node> for JsNode {
    fn from(node: &model::Node) -> Self {
        JsNode {
            id: node.id.0.clone(),
            node_type: node.node_type.as_str().to_string(),
            content: node.content.clone(),
            parent_id: node.parent_id.as_ref().map(|id| id.0.clone()),
            children: node.children.iter().map(|id| id.0.clone()).collect(),
            metadata: node.metadata.clone(),
            previous_values: node
                .previous_values
                .iter()
                .map(|sv| JsSupersededValue {
                    old_content: sv.old_content.clone(),
                    superseded_at: sv.superseded_at.to_rfc3339(),
                    reason: sv.reason.clone(),
                })
                .collect(),
            temporal: node.temporal.as_ref().map(|t| JsTemporalMetadata {
                valid_from: t.valid_from.map(|d| d.to_rfc3339()),
                valid_until: t.valid_until.map(|d| d.to_rfc3339()),
                label: t.label.clone(),
            }),
            created_at: node.created_at.to_rfc3339(),
            updated_at: node.updated_at.to_rfc3339(),
        }
    }
}

impl From<&model::Link> for JsLink {
    fn from(link: &model::Link) -> Self {
        JsLink {
            id: link.id.0.clone(),
            from_node: link.from_node.0.clone(),
            to_node: link.to_node.0.clone(),
            relation: link.relation.clone(),
            bidirectional: link.bidirectional,
            confidence: link.confidence.as_ref().map(|c| c.as_str().to_string()),
            created_at: link.created_at.to_rfc3339(),
        }
    }
}

impl From<&search::SearchResult> for JsSearchResult {
    fn from(r: &search::SearchResult) -> Self {
        JsSearchResult {
            node_id: r.node_id.0.clone(),
            node_type: r.node_type.clone(),
            content: r.content.clone(),
            score: r.score,
            matched_field: r.matched_field.clone(),
            depth: r.depth as u32,
        }
    }
}

impl From<&vcs::types::CommitEntry> for JsCommitEntry {
    fn from(entry: &vcs::types::CommitEntry) -> Self {
        let (source, source_detail) = match &entry.data.source {
            vcs::types::CommitSource::Conversation {
                conversation_id,
                summary,
            } => (
                "conversation".to_string(),
                conversation_id.clone().or_else(|| summary.clone()),
            ),
            vcs::types::CommitSource::Maintenance { job_id } => {
                ("maintenance".to_string(), job_id.clone())
            }
            vcs::types::CommitSource::Manual { tool_name } => {
                ("manual".to_string(), tool_name.clone())
            }
            vcs::types::CommitSource::Merge {
                source_branch,
                target_branch,
            } => (
                "merge".to_string(),
                Some(format!("{} -> {}", source_branch, target_branch)),
            ),
            vcs::types::CommitSource::Migration => ("migration".to_string(), None),
        };
        JsCommitEntry {
            hash: entry.hash.0.clone(),
            message: entry.data.message.clone(),
            timestamp: entry.data.timestamp.to_rfc3339(),
            source,
            source_detail,
            parents: entry.data.parents.iter().map(|p| p.0.clone()).collect(),
            storage_type: match entry.data.storage_type {
                vcs::types::CommitStorageType::Snapshot => "snapshot".to_string(),
                vcs::types::CommitStorageType::Delta => "delta".to_string(),
            },
        }
    }
}

impl From<&vcs::diff::NodeChangeSummary> for JsNodeChangeSummary {
    fn from(n: &vcs::diff::NodeChangeSummary) -> Self {
        JsNodeChangeSummary {
            node_id: n.node_id.clone(),
            node_type: n.node_type.clone(),
            content: n.content.clone(),
            old_content: n.old_content.clone(),
            path: n.path.clone(),
        }
    }
}

impl From<&vcs::diff::LinkChangeSummary> for JsLinkChangeSummary {
    fn from(l: &vcs::diff::LinkChangeSummary) -> Self {
        JsLinkChangeSummary {
            link_id: l.link_id.clone(),
            from_node: l.from_node.clone(),
            to_node: l.to_node.clone(),
            relation: l.relation.clone(),
            bidirectional: l.bidirectional,
            confidence: l.confidence.clone(),
        }
    }
}

impl From<&vcs::diff::ChangeSummary> for JsChangeSummary {
    fn from(diff: &vcs::diff::ChangeSummary) -> Self {
        JsChangeSummary {
            nodes_created: convert_vec(&diff.nodes_created),
            nodes_updated: convert_vec(&diff.nodes_updated),
            nodes_deleted: convert_vec(&diff.nodes_deleted),
            links_created: convert_vec(&diff.links_created),
            links_removed: convert_vec(&diff.links_removed),
            links_updated: convert_vec(&diff.links_updated),
        }
    }
}

impl From<&vcs::repository::BranchInfo> for JsBranchInfo {
    fn from(b: &vcs::repository::BranchInfo) -> Self {
        JsBranchInfo {
            name: b.name.clone(),
            head: b.head.0.clone(),
            is_current: b.is_current,
        }
    }
}

impl From<JsCommitInput> for vcs::types::CommitInput {
    fn from(input: JsCommitInput) -> Self {
        let source = match input.source.as_str() {
            "conversation" => vcs::types::CommitSource::Conversation {
                conversation_id: input.conversation_id,
                summary: input.summary,
            },
            "maintenance" => vcs::types::CommitSource::Maintenance {
                job_id: input.job_id,
            },
            "migration" => vcs::types::CommitSource::Migration,
            _ => vcs::types::CommitSource::Manual {
                tool_name: input.tool_name,
            },
        };
        vcs::types::CommitInput {
            message: input.message,
            source,
        }
    }
}

pub fn diff_has_changes(diff: &vcs::diff::ChangeSummary) -> bool {
    !diff.nodes_created.is_empty()
        || !diff.nodes_updated.is_empty()
        || !diff.nodes_deleted.is_empty()
        || !diff.links_created.is_empty()
        || !diff.links_removed.is_empty()
        || !diff.links_updated.is_empty()
}
