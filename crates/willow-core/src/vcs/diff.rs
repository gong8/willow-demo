use crate::model::{Graph, NodeId};
use tracing::debug;

#[derive(Debug, Clone)]
pub struct NodeChangeSummary {
    pub node_id: String,
    pub node_type: String,
    pub content: String,
    pub old_content: Option<String>,
    pub path: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LinkChangeSummary {
    pub link_id: String,
    pub from_node: String,
    pub to_node: String,
    pub relation: String,
}

#[derive(Debug, Clone, Default)]
pub struct ChangeSummary {
    pub nodes_created: Vec<NodeChangeSummary>,
    pub nodes_updated: Vec<NodeChangeSummary>,
    pub nodes_deleted: Vec<NodeChangeSummary>,
    pub links_created: Vec<LinkChangeSummary>,
    pub links_removed: Vec<LinkChangeSummary>,
}

/// Build the path from root to a node (list of content strings).
fn build_node_path(graph: &Graph, node_id: &NodeId) -> Vec<String> {
    let mut path = Vec::new();
    let mut current = Some(node_id.clone());
    while let Some(id) = current {
        if let Some(node) = graph.nodes.get(&id) {
            path.push(node.content.clone());
            current = node.parent_id.clone();
        } else {
            break;
        }
    }
    path.reverse();
    path
}

/// Compute a diff between two graph states.
pub fn compute_graph_diff(old: &Graph, new: &Graph) -> ChangeSummary {
    let mut summary = ChangeSummary::default();

    // Nodes created (in new but not old)
    for (nid, node) in &new.nodes {
        if !old.nodes.contains_key(nid) {
            summary.nodes_created.push(NodeChangeSummary {
                node_id: nid.0.clone(),
                node_type: node.node_type.as_str().to_string(),
                content: node.content.clone(),
                old_content: None,
                path: build_node_path(new, nid),
            });
        }
    }

    // Nodes deleted (in old but not new)
    for (nid, node) in &old.nodes {
        if !new.nodes.contains_key(nid) {
            summary.nodes_deleted.push(NodeChangeSummary {
                node_id: nid.0.clone(),
                node_type: node.node_type.as_str().to_string(),
                content: node.content.clone(),
                old_content: None,
                path: build_node_path(old, nid),
            });
        }
    }

    // Nodes updated (in both, but content or metadata changed)
    for (nid, new_node) in &new.nodes {
        if let Some(old_node) = old.nodes.get(nid) {
            if old_node.content != new_node.content || old_node.metadata != new_node.metadata {
                summary.nodes_updated.push(NodeChangeSummary {
                    node_id: nid.0.clone(),
                    node_type: new_node.node_type.as_str().to_string(),
                    content: new_node.content.clone(),
                    old_content: Some(old_node.content.clone()),
                    path: build_node_path(new, nid),
                });
            }
        }
    }

    // Links created
    for (lid, link) in &new.links {
        if !old.links.contains_key(lid) {
            summary.links_created.push(LinkChangeSummary {
                link_id: lid.0.clone(),
                from_node: link.from_node.0.clone(),
                to_node: link.to_node.0.clone(),
                relation: link.relation.clone(),
            });
        }
    }

    // Links removed
    for (lid, link) in &old.links {
        if !new.links.contains_key(lid) {
            summary.links_removed.push(LinkChangeSummary {
                link_id: lid.0.clone(),
                from_node: link.from_node.0.clone(),
                to_node: link.to_node.0.clone(),
                relation: link.relation.clone(),
            });
        }
    }

    debug!(created = summary.nodes_created.len(), updated = summary.nodes_updated.len(), deleted = summary.nodes_deleted.len(), "graph diff computed");
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use chrono::Utc;
    use std::collections::HashMap;

    fn empty_graph() -> Graph {
        let root_id = NodeId("root".to_string());
        let mut nodes = HashMap::new();
        nodes.insert(
            root_id.clone(),
            Node {
                id: root_id.clone(),
                node_type: NodeType::Root,
                content: "User".to_string(),
                parent_id: None,
                children: Vec::new(),
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        );
        Graph {
            root_id,
            nodes,
            links: HashMap::new(),
        }
    }

    #[test]
    fn test_diff_identical_graphs() {
        let g = empty_graph();
        let diff = compute_graph_diff(&g, &g);
        assert!(diff.nodes_created.is_empty());
        assert!(diff.nodes_updated.is_empty());
        assert!(diff.nodes_deleted.is_empty());
        assert!(diff.links_created.is_empty());
        assert!(diff.links_removed.is_empty());
    }

    #[test]
    fn test_diff_node_created() {
        let old = empty_graph();
        let mut new = old.clone();
        let nid = NodeId("n1".to_string());
        new.nodes.insert(
            nid.clone(),
            Node {
                id: nid.clone(),
                node_type: NodeType::Detail,
                content: "Likes pizza".to_string(),
                parent_id: Some(NodeId("root".to_string())),
                children: Vec::new(),
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        );
        new.nodes
            .get_mut(&NodeId("root".to_string()))
            .unwrap()
            .children
            .push(nid);

        let diff = compute_graph_diff(&old, &new);
        assert_eq!(diff.nodes_created.len(), 1);
        assert_eq!(diff.nodes_created[0].content, "Likes pizza");
        assert!(diff.nodes_deleted.is_empty());
        assert!(diff.nodes_updated.is_empty());
    }

    #[test]
    fn test_diff_node_updated() {
        let mut old = empty_graph();
        let nid = NodeId("n1".to_string());
        old.nodes.insert(
            nid.clone(),
            Node {
                id: nid.clone(),
                node_type: NodeType::Detail,
                content: "Old content".to_string(),
                parent_id: Some(NodeId("root".to_string())),
                children: Vec::new(),
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        );

        let mut new = old.clone();
        new.nodes.get_mut(&nid).unwrap().content = "New content".to_string();

        let diff = compute_graph_diff(&old, &new);
        assert_eq!(diff.nodes_updated.len(), 1);
        assert_eq!(diff.nodes_updated[0].old_content.as_deref(), Some("Old content"));
        assert_eq!(diff.nodes_updated[0].content, "New content");
    }

    #[test]
    fn test_diff_node_deleted() {
        let mut old = empty_graph();
        let nid = NodeId("n1".to_string());
        old.nodes.insert(
            nid.clone(),
            Node {
                id: nid.clone(),
                node_type: NodeType::Detail,
                content: "Gone".to_string(),
                parent_id: Some(NodeId("root".to_string())),
                children: Vec::new(),
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        );
        let new = empty_graph();

        let diff = compute_graph_diff(&old, &new);
        assert_eq!(diff.nodes_deleted.len(), 1);
        assert_eq!(diff.nodes_deleted[0].content, "Gone");
    }

    #[test]
    fn test_diff_links() {
        let old = empty_graph();
        let mut new = old.clone();
        let lid = LinkId("l1".to_string());
        new.links.insert(
            lid.clone(),
            Link {
                id: lid,
                from_node: NodeId("root".to_string()),
                to_node: NodeId("root".to_string()),
                relation: "self".to_string(),
                created_at: Utc::now(),
            },
        );

        let diff = compute_graph_diff(&old, &new);
        assert_eq!(diff.links_created.len(), 1);
        assert_eq!(diff.links_created[0].relation, "self");

        // Reverse
        let diff2 = compute_graph_diff(&new, &old);
        assert_eq!(diff2.links_removed.len(), 1);
    }
}
