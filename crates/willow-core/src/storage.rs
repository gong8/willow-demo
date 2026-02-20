use crate::error::WillowError;
use crate::model::{Graph, Node, NodeId, NodeType};
use chrono::Utc;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tracing::{info, debug};

pub fn load_graph(path: &Path) -> Result<Graph, WillowError> {
    debug!(path = %path.display(), "loading graph");
    let data = fs::read_to_string(path)?;
    let graph: Graph = serde_json::from_str(&data)?;
    info!(nodes = graph.nodes.len(), links = graph.links.len(), "graph loaded");
    Ok(graph)
}

pub fn save_graph(path: &Path, graph: &Graph) -> Result<(), WillowError> {
    debug!(path = %path.display(), "saving graph");
    let json = serde_json::to_string_pretty(graph)?;
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &json)?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}

pub fn create_default_graph() -> Graph {
    let root_id = NodeId("root".to_string());
    let now = Utc::now();

    let root = Node {
        id: root_id.clone(),
        node_type: NodeType::Root,
        content: "User".to_string(),
        parent_id: None,
        children: Vec::new(),
        metadata: HashMap::new(),
        previous_values: Vec::new(),
        temporal: None,
        created_at: now,
        updated_at: now,
    };

    let mut nodes = HashMap::new();
    nodes.insert(root_id.clone(), root);

    Graph {
        root_id,
        nodes,
        links: HashMap::new(),
    }
}
