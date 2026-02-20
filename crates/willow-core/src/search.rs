use std::collections::VecDeque;

use crate::model::{Graph, Node, NodeId};
use tracing::debug;

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub node_id: NodeId,
    pub node_type: String,
    pub content: String,
    pub score: f64,
    pub matched_field: String,
    pub depth: usize,
}

/// Search the graph by traversing from the root node via BFS.
/// Only nodes reachable through the tree hierarchy are visited.
pub fn search_nodes(graph: &Graph, query: &str, max_results: usize) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    let terms: Vec<&str> = query_lower.split_whitespace().collect();

    if terms.is_empty() {
        return Vec::new();
    }

    let mut results: Vec<SearchResult> = Vec::new();
    let mut queue: VecDeque<(&NodeId, usize)> = VecDeque::new();
    queue.push_back((&graph.root_id, 0));

    while let Some((node_id, depth)) = queue.pop_front() {
        let Some(node) = graph.nodes.get(node_id) else { continue };

        if let Some(result) = score_node(node, &query_lower, &terms, depth) {
            results.push(result);
        }

        for child_id in &node.children {
            queue.push_back((child_id, depth + 1));
        }
    }

    results.sort_by(|a, b| b.score.total_cmp(&a.score));
    results.truncate(max_results);
    debug!(query = %query, results = results.len(), "search complete");
    results
}

fn score_node(node: &Node, query_lower: &str, terms: &[&str], depth: usize) -> Option<SearchResult> {
    let candidates = [
        (1.0, "content", node.content.as_str()),
        (0.3, "node_type", node.node_type.as_str()),
    ];

    let (best_score, best_field) = candidates
        .into_iter()
        .map(|(weight, field, text)| (score_text(text, query_lower, terms) * weight, field.to_string()))
        .chain(node.metadata.iter().map(|(k, v)| {
            (score_text(v, query_lower, terms) * 0.5, format!("metadata.{k}"))
        }))
        .max_by(|a, b| a.0.total_cmp(&b.0))?;

    if best_score > 0.0 {
        Some(SearchResult {
            node_id: node.id.clone(),
            node_type: node.node_type.to_string(),
            content: node.content.clone(),
            score: best_score,
            matched_field: best_field,
            depth,
        })
    } else {
        None
    }
}

fn score_text(text: &str, query_lower: &str, terms: &[&str]) -> f64 {
    let text_lower = text.to_lowercase();

    if text_lower.contains(query_lower) {
        return 1.0;
    }

    let matched = terms.iter().filter(|t| text_lower.contains(**t)).count();

    match matched {
        n if n == terms.len() => 0.6,
        0 => 0.0,
        n => 0.3 * (n as f64 / terms.len() as f64),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::create_default_graph;
    use crate::model::{Node, NodeId, NodeType};
    use chrono::Utc;
    use std::collections::HashMap;

    /// Insert a node into the graph and wire it into the root's children list.
    fn insert_child_of_root(graph: &mut Graph, id: &str, content: &str, node_type: NodeType) -> NodeId {
        let now = Utc::now();
        let node_id = NodeId(id.to_string());
        let node = Node {
            id: node_id.clone(),
            node_type,
            content: content.to_string(),
            parent_id: Some(graph.root_id.clone()),
            children: Vec::new(),
            metadata: HashMap::new(),
            previous_values: Vec::new(),
            temporal: None,
            created_at: now,
            updated_at: now,
        };
        graph.nodes.insert(node.id.clone(), node);
        graph.nodes.get_mut(&graph.root_id).unwrap().children.push(node_id.clone());
        node_id
    }

    #[test]
    fn test_exact_match_scores_highest() {
        let mut graph = create_default_graph();
        insert_child_of_root(&mut graph, "n1", "favorite color is blue", NodeType::Detail);

        let results = search_nodes(&graph, "favorite color is blue", 10);
        assert_eq!(results.len(), 1);
        assert!((results[0].score - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_partial_term_match() {
        let mut graph = create_default_graph();
        insert_child_of_root(&mut graph, "n1", "likes pizza and pasta", NodeType::Detail);

        let results = search_nodes(&graph, "pizza sushi", 10);
        assert_eq!(results.len(), 1);
        assert!(results[0].score > 0.0);
        assert!(results[0].score < 0.6);
    }

    #[test]
    fn test_no_match() {
        let mut graph = create_default_graph();
        insert_child_of_root(&mut graph, "n1", "likes pizza", NodeType::Detail);

        let results = search_nodes(&graph, "quantum mechanics", 10);
        assert!(results.is_empty());
    }

    #[test]
    fn test_metadata_match() {
        let mut graph = create_default_graph();
        let node_id = insert_child_of_root(&mut graph, "n1", "some content", NodeType::Detail);
        graph.nodes.get_mut(&node_id).unwrap()
            .metadata.insert("source".to_string(), "conversation about hobbies".to_string());

        let results = search_nodes(&graph, "hobbies", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matched_field, "metadata.source");
    }

    #[test]
    fn test_results_limited_and_sorted() {
        let mut graph = create_default_graph();
        for i in 0..20 {
            insert_child_of_root(
                &mut graph,
                &format!("n{}", i),
                &format!("item number {}", i),
                NodeType::Detail,
            );
        }

        let results = search_nodes(&graph, "item", 5);
        assert_eq!(results.len(), 5);
        for i in 1..results.len() {
            assert!(results[i - 1].score >= results[i].score);
        }
    }

    #[test]
    fn test_unreachable_node_not_found() {
        let mut graph = create_default_graph();
        // Insert directly into the HashMap but NOT into any node's children list.
        // BFS from root should never reach this node.
        let now = Utc::now();
        let orphan = Node {
            id: NodeId("orphan".to_string()),
            node_type: NodeType::Detail,
            content: "secret orphan data".to_string(),
            parent_id: None,
            children: Vec::new(),
            metadata: HashMap::new(),
            previous_values: Vec::new(),
            temporal: None,
            created_at: now,
            updated_at: now,
        };
        graph.nodes.insert(orphan.id.clone(), orphan);

        let results = search_nodes(&graph, "orphan", 10);
        assert!(results.is_empty(), "orphan node should not be reachable via BFS from root");
    }

    #[test]
    fn test_depth_reported_correctly() {
        let mut graph = create_default_graph();
        let cat_id = insert_child_of_root(&mut graph, "cat", "food preferences", NodeType::Category);

        // Add a grandchild under the category
        let now = Utc::now();
        let detail_id = NodeId("detail".to_string());
        let detail = Node {
            id: detail_id.clone(),
            node_type: NodeType::Detail,
            content: "favorite food is pizza".to_string(),
            parent_id: Some(cat_id.clone()),
            children: Vec::new(),
            metadata: HashMap::new(),
            previous_values: Vec::new(),
            temporal: None,
            created_at: now,
            updated_at: now,
        };
        graph.nodes.insert(detail.id.clone(), detail);
        graph.nodes.get_mut(&cat_id).unwrap().children.push(detail_id);

        let results = search_nodes(&graph, "pizza", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].depth, 2); // root(0) -> cat(1) -> detail(2)
    }
}
