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

impl NodeChangeSummary {
    fn new(node: &crate::model::Node, old_content: Option<String>, path: Vec<String>) -> Self {
        Self {
            node_id: node.id.0.clone(),
            node_type: node.node_type.as_str().to_string(),
            content: node.content.clone(),
            old_content,
            path,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LinkChangeSummary {
    pub link_id: String,
    pub from_node: String,
    pub to_node: String,
    pub relation: String,
    pub bidirectional: bool,
    pub confidence: Option<String>,
}

impl LinkChangeSummary {
    fn from_link(id: &crate::model::LinkId, link: &crate::model::Link) -> Self {
        Self {
            link_id: id.0.clone(),
            from_node: link.from_node.0.clone(),
            to_node: link.to_node.0.clone(),
            relation: link.relation.clone(),
            bidirectional: link.bidirectional,
            confidence: link.confidence.as_ref().map(|c| c.as_str().to_string()),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ChangeSummary {
    pub nodes_created: Vec<NodeChangeSummary>,
    pub nodes_updated: Vec<NodeChangeSummary>,
    pub nodes_deleted: Vec<NodeChangeSummary>,
    pub links_created: Vec<LinkChangeSummary>,
    pub links_removed: Vec<LinkChangeSummary>,
    pub links_updated: Vec<LinkChangeSummary>,
}

impl ChangeSummary {
    pub fn is_empty(&self) -> bool {
        self.nodes_created.is_empty()
            && self.nodes_updated.is_empty()
            && self.nodes_deleted.is_empty()
            && self.links_created.is_empty()
            && self.links_removed.is_empty()
            && self.links_updated.is_empty()
    }
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

/// Collect items from `source` whose keys are absent in `other`.
fn diff_keys_only_in<K, V, T>(
    source: &std::collections::HashMap<K, V>,
    other: &std::collections::HashMap<K, V>,
    map_fn: impl Fn(&K, &V) -> T,
) -> Vec<T>
where
    K: Eq + std::hash::Hash,
{
    source.iter()
        .filter(|(k, _)| !other.contains_key(k))
        .map(|(k, v)| map_fn(k, v))
        .collect()
}

/// Compute a diff between two graph states.
pub fn compute_graph_diff(old: &Graph, new: &Graph) -> ChangeSummary {
    let nodes_created = diff_keys_only_in(&new.nodes, &old.nodes, |nid, node| {
        NodeChangeSummary::new(node, None, build_node_path(new, nid))
    });
    let nodes_deleted = diff_keys_only_in(&old.nodes, &new.nodes, |nid, node| {
        NodeChangeSummary::new(node, None, build_node_path(old, nid))
    });
    let nodes_updated: Vec<_> = new.nodes.iter()
        .filter_map(|(nid, new_node)| {
            let old_node = old.nodes.get(nid)?;
            (old_node.content != new_node.content || old_node.metadata != new_node.metadata)
                .then(|| NodeChangeSummary::new(new_node, Some(old_node.content.clone()), build_node_path(new, nid)))
        })
        .collect();

    let links_created = diff_keys_only_in(&new.links, &old.links, LinkChangeSummary::from_link);
    let links_removed = diff_keys_only_in(&old.links, &new.links, LinkChangeSummary::from_link);
    let links_updated: Vec<_> = new.links.iter()
        .filter_map(|(lid, new_link)| {
            let old_link = old.links.get(lid)?;
            (old_link.relation != new_link.relation
                || old_link.bidirectional != new_link.bidirectional
                || old_link.confidence != new_link.confidence)
                .then(|| LinkChangeSummary::from_link(lid, new_link))
        })
        .collect();

    debug!(created = nodes_created.len(), updated = nodes_updated.len(), deleted = nodes_deleted.len(), "graph diff computed");
    ChangeSummary { nodes_created, nodes_updated, nodes_deleted, links_created, links_removed, links_updated }
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
                bidirectional: false,
                confidence: None,
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

    #[test]
    fn test_diff_link_updated() {
        let mut old = empty_graph();
        let lid = LinkId("l1".to_string());
        old.links.insert(
            lid.clone(),
            Link {
                id: lid.clone(),
                from_node: NodeId("root".to_string()),
                to_node: NodeId("root".to_string()),
                relation: "related_to".to_string(),
                bidirectional: false,
                confidence: None,
                created_at: Utc::now(),
            },
        );

        let mut new = old.clone();
        let link = new.links.get_mut(&lid).unwrap();
        link.relation = "caused_by".to_string();
        link.bidirectional = true;
        link.confidence = Some(crate::model::ConfidenceLevel::High);

        let diff = compute_graph_diff(&old, &new);
        assert_eq!(diff.links_updated.len(), 1);
        assert_eq!(diff.links_updated[0].relation, "caused_by");
        assert!(diff.links_updated[0].bidirectional);
        assert_eq!(diff.links_updated[0].confidence.as_deref(), Some("high"));
        assert!(diff.links_created.is_empty());
        assert!(diff.links_removed.is_empty());
    }
}
