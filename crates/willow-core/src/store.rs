use crate::error::WillowError;
use crate::model::*;
use crate::search;
use crate::storage;
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct ContextResult {
    pub node: Node,
    pub ancestors: Vec<Node>,
    pub descendants: Vec<Node>,
    pub links: Vec<Link>,
}

pub struct GraphStore {
    pub graph: Graph,
    pub path: PathBuf,
}

impl GraphStore {
    pub fn open(path: &Path) -> Result<Self, WillowError> {
        let graph = if path.exists() {
            storage::load_graph(path)?
        } else {
            let graph = storage::create_default_graph();
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            storage::save_graph(path, &graph)?;
            graph
        };

        Ok(GraphStore {
            graph,
            path: path.to_path_buf(),
        })
    }

    fn save(&self) -> Result<(), WillowError> {
        storage::save_graph(&self.path, &self.graph)
    }

    pub fn create_node(
        &mut self,
        parent_id: &str,
        node_type: &str,
        content: &str,
        metadata: Option<HashMap<String, String>>,
        temporal: Option<TemporalMetadata>,
    ) -> Result<Node, WillowError> {
        let parent_nid = NodeId(parent_id.to_string());

        if !self.graph.nodes.contains_key(&parent_nid) {
            return Err(WillowError::ParentNotFound(parent_id.to_string()));
        }

        let nt = NodeType::from_str(node_type)
            .ok_or_else(|| WillowError::InvalidNodeType(node_type.to_string()))?;

        let now = Utc::now();
        let node_id = NodeId(Uuid::new_v4().to_string());

        let node = Node {
            id: node_id.clone(),
            node_type: nt,
            content: content.to_string(),
            parent_id: Some(parent_nid.clone()),
            children: Vec::new(),
            metadata: metadata.unwrap_or_default(),
            previous_values: Vec::new(),
            temporal,
            created_at: now,
            updated_at: now,
        };

        // Add to parent's children
        self.graph
            .nodes
            .get_mut(&parent_nid)
            .unwrap()
            .children
            .push(node_id.clone());

        self.graph.nodes.insert(node_id, node.clone());
        self.save()?;

        Ok(node)
    }

    pub fn get_context(
        &self,
        node_id: &str,
        depth: Option<u32>,
    ) -> Result<ContextResult, WillowError> {
        let nid = NodeId(node_id.to_string());
        let node = self
            .graph
            .nodes
            .get(&nid)
            .ok_or_else(|| WillowError::NodeNotFound(node_id.to_string()))?
            .clone();

        // Collect ancestors
        let mut ancestors = Vec::new();
        let mut current_id = node.parent_id.clone();
        while let Some(pid) = current_id {
            if let Some(parent) = self.graph.nodes.get(&pid) {
                ancestors.push(parent.clone());
                current_id = parent.parent_id.clone();
            } else {
                break;
            }
        }

        // Collect descendants up to depth
        let max_depth = depth.unwrap_or(2);
        let mut descendants = Vec::new();
        self.collect_descendants(&nid, max_depth, 0, &mut descendants);

        // Collect all node IDs involved
        let mut involved_ids: std::collections::HashSet<&NodeId> = std::collections::HashSet::new();
        involved_ids.insert(&nid);
        for a in &ancestors {
            involved_ids.insert(&a.id);
        }
        for d in &descendants {
            involved_ids.insert(&d.id);
        }

        // Find all links touching any involved node
        let links: Vec<Link> = self
            .graph
            .links
            .values()
            .filter(|link| {
                involved_ids.contains(&link.from_node) || involved_ids.contains(&link.to_node)
            })
            .cloned()
            .collect();

        Ok(ContextResult {
            node,
            ancestors,
            descendants,
            links,
        })
    }

    fn collect_descendants(
        &self,
        node_id: &NodeId,
        max_depth: u32,
        current_depth: u32,
        result: &mut Vec<Node>,
    ) {
        if current_depth >= max_depth {
            return;
        }

        if let Some(node) = self.graph.nodes.get(node_id) {
            for child_id in &node.children {
                if let Some(child) = self.graph.nodes.get(child_id) {
                    result.push(child.clone());
                    self.collect_descendants(child_id, max_depth, current_depth + 1, result);
                }
            }
        }
    }

    pub fn update_node(
        &mut self,
        node_id: &str,
        content: Option<&str>,
        metadata: Option<HashMap<String, String>>,
        temporal: Option<TemporalMetadata>,
        reason: Option<&str>,
    ) -> Result<Node, WillowError> {
        let nid = NodeId(node_id.to_string());
        let node = self
            .graph
            .nodes
            .get_mut(&nid)
            .ok_or_else(|| WillowError::NodeNotFound(node_id.to_string()))?;

        if let Some(new_content) = content {
            if new_content != node.content {
                // Push old content to previous_values
                node.previous_values.push(SupersededValue {
                    old_content: node.content.clone(),
                    superseded_at: Utc::now(),
                    reason: reason.map(|s| s.to_string()),
                });
                node.content = new_content.to_string();
            }
        }

        if let Some(new_metadata) = metadata {
            node.metadata = new_metadata;
        }

        if let Some(new_temporal) = temporal {
            node.temporal = Some(new_temporal);
        }

        node.updated_at = Utc::now();

        let updated = node.clone();
        self.save()?;

        Ok(updated)
    }

    pub fn delete_node(&mut self, node_id: &str) -> Result<(), WillowError> {
        let nid = NodeId(node_id.to_string());

        if nid == self.graph.root_id {
            return Err(WillowError::CannotDeleteRoot);
        }

        if !self.graph.nodes.contains_key(&nid) {
            return Err(WillowError::NodeNotFound(node_id.to_string()));
        }

        // Collect all descendants recursively
        let mut to_delete = Vec::new();
        self.collect_all_descendants(&nid, &mut to_delete);
        to_delete.push(nid.clone());

        // Remove from parent's children
        if let Some(parent_id) = self.graph.nodes.get(&nid).and_then(|n| n.parent_id.clone()) {
            if let Some(parent) = self.graph.nodes.get_mut(&parent_id) {
                parent.children.retain(|c| c != &nid);
            }
        }

        // Remove all nodes
        let delete_set: std::collections::HashSet<&NodeId> = to_delete.iter().collect();
        for id in &to_delete {
            self.graph.nodes.remove(id);
        }

        // Remove links referencing any deleted node
        self.graph
            .links
            .retain(|_, link| !delete_set.contains(&link.from_node) && !delete_set.contains(&link.to_node));

        self.save()?;

        Ok(())
    }

    fn collect_all_descendants(&self, node_id: &NodeId, result: &mut Vec<NodeId>) {
        if let Some(node) = self.graph.nodes.get(node_id) {
            for child_id in &node.children {
                result.push(child_id.clone());
                self.collect_all_descendants(child_id, result);
            }
        }
    }

    pub fn add_link(
        &mut self,
        from_node: &str,
        to_node: &str,
        relation: &str,
    ) -> Result<Link, WillowError> {
        let from_nid = NodeId(from_node.to_string());
        let to_nid = NodeId(to_node.to_string());

        if !self.graph.nodes.contains_key(&from_nid) {
            return Err(WillowError::NodeNotFound(from_node.to_string()));
        }
        if !self.graph.nodes.contains_key(&to_nid) {
            return Err(WillowError::NodeNotFound(to_node.to_string()));
        }

        // Check for duplicate
        let is_dup = self.graph.links.values().any(|link| {
            link.from_node == from_nid && link.to_node == to_nid && link.relation == relation
        });
        if is_dup {
            return Err(WillowError::DuplicateLink {
                from: from_node.to_string(),
                to: to_node.to_string(),
                relation: relation.to_string(),
            });
        }

        let link = Link {
            id: LinkId(Uuid::new_v4().to_string()),
            from_node: from_nid,
            to_node: to_nid,
            relation: relation.to_string(),
            created_at: Utc::now(),
        };

        self.graph.links.insert(link.id.clone(), link.clone());
        self.save()?;

        Ok(link)
    }

    pub fn search_nodes(
        &self,
        query: &str,
        max_results: Option<usize>,
    ) -> Vec<search::SearchResult> {
        search::search_nodes(&self.graph, query, max_results.unwrap_or(10))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn temp_store() -> GraphStore {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        // Drop the temp file so GraphStore creates it fresh
        drop(tmp);
        let _ = std::fs::remove_file(&path);
        GraphStore::open(&path).unwrap()
    }

    #[test]
    fn test_open_creates_default_graph() {
        let store = temp_store();
        assert!(store.graph.nodes.contains_key(&NodeId("root".to_string())));
        assert_eq!(store.graph.nodes.len(), 1);
    }

    #[test]
    fn test_create_and_get_node() {
        let mut store = temp_store();
        let node = store
            .create_node("root", "category", "Hobbies", None, None)
            .unwrap();
        assert_eq!(node.content, "Hobbies");
        assert_eq!(node.node_type, NodeType::Category);

        let ctx = store.get_context(&node.id.0, Some(1)).unwrap();
        assert_eq!(ctx.node.content, "Hobbies");
        assert_eq!(ctx.ancestors.len(), 1); // root
        assert_eq!(ctx.ancestors[0].id.0, "root");
    }

    #[test]
    fn test_create_node_invalid_parent() {
        let mut store = temp_store();
        let result = store.create_node("nonexistent", "category", "Test", None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_node_invalid_type() {
        let mut store = temp_store();
        let result = store.create_node("root", "invalid_type", "Test", None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_node_tracks_history() {
        let mut store = temp_store();
        let node = store
            .create_node("root", "detail", "Favorite color: blue", None, None)
            .unwrap();

        let updated = store
            .update_node(
                &node.id.0,
                Some("Favorite color: green"),
                None,
                None,
                Some("Changed preference"),
            )
            .unwrap();

        assert_eq!(updated.content, "Favorite color: green");
        assert_eq!(updated.previous_values.len(), 1);
        assert_eq!(updated.previous_values[0].old_content, "Favorite color: blue");
        assert_eq!(
            updated.previous_values[0].reason.as_deref(),
            Some("Changed preference")
        );
    }

    #[test]
    fn test_update_node_same_content_no_history() {
        let mut store = temp_store();
        let node = store
            .create_node("root", "detail", "Same content", None, None)
            .unwrap();

        let updated = store
            .update_node(&node.id.0, Some("Same content"), None, None, None)
            .unwrap();

        assert!(updated.previous_values.is_empty());
    }

    #[test]
    fn test_delete_node_cascades() {
        let mut store = temp_store();
        let cat = store
            .create_node("root", "category", "Hobbies", None, None)
            .unwrap();
        let detail = store
            .create_node(&cat.id.0, "detail", "Reading", None, None)
            .unwrap();
        let _link = store.add_link(&cat.id.0, &detail.id.0, "includes").unwrap();

        assert_eq!(store.graph.nodes.len(), 3);
        assert_eq!(store.graph.links.len(), 1);

        store.delete_node(&cat.id.0).unwrap();

        assert_eq!(store.graph.nodes.len(), 1); // only root
        assert_eq!(store.graph.links.len(), 0);
        // Root's children should be empty
        assert!(store.graph.nodes[&NodeId("root".to_string())]
            .children
            .is_empty());
    }

    #[test]
    fn test_cannot_delete_root() {
        let mut store = temp_store();
        let result = store.delete_node("root");
        assert!(result.is_err());
    }

    #[test]
    fn test_add_link() {
        let mut store = temp_store();
        let a = store
            .create_node("root", "category", "A", None, None)
            .unwrap();
        let b = store
            .create_node("root", "category", "B", None, None)
            .unwrap();
        let link = store.add_link(&a.id.0, &b.id.0, "related_to").unwrap();

        assert_eq!(link.from_node, a.id);
        assert_eq!(link.to_node, b.id);
        assert_eq!(link.relation, "related_to");
    }

    #[test]
    fn test_duplicate_link_rejected() {
        let mut store = temp_store();
        let a = store
            .create_node("root", "category", "A", None, None)
            .unwrap();
        let b = store
            .create_node("root", "category", "B", None, None)
            .unwrap();
        store.add_link(&a.id.0, &b.id.0, "related_to").unwrap();
        let result = store.add_link(&a.id.0, &b.id.0, "related_to");
        assert!(result.is_err());
    }

    #[test]
    fn test_search_nodes() {
        let mut store = temp_store();
        store
            .create_node("root", "detail", "Favorite food is pizza", None, None)
            .unwrap();
        store
            .create_node("root", "detail", "Works at Google", None, None)
            .unwrap();

        let results = store.search_nodes("pizza", None);
        assert_eq!(results.len(), 1);
        assert!(results[0].content.contains("pizza"));
    }

    #[test]
    fn test_get_context_with_depth() {
        let mut store = temp_store();
        let cat = store
            .create_node("root", "category", "Hobbies", None, None)
            .unwrap();
        let sub = store
            .create_node(&cat.id.0, "detail", "Reading", None, None)
            .unwrap();
        let _deep = store
            .create_node(&sub.id.0, "detail", "Sci-fi novels", None, None)
            .unwrap();

        // Depth 1 from category should only get immediate children
        let ctx = store.get_context(&cat.id.0, Some(1)).unwrap();
        assert_eq!(ctx.descendants.len(), 1);
        assert_eq!(ctx.descendants[0].content, "Reading");

        // Depth 2 should get both levels
        let ctx = store.get_context(&cat.id.0, Some(2)).unwrap();
        assert_eq!(ctx.descendants.len(), 2);
    }

    #[test]
    fn test_create_new_node_types() {
        let mut store = temp_store();
        let cat = store
            .create_node("root", "category", "Education", None, None)
            .unwrap();
        assert_eq!(cat.node_type, NodeType::Category);

        let entity = store
            .create_node(&cat.id.0, "entity", "Imperial College London", None, None)
            .unwrap();
        assert_eq!(entity.node_type, NodeType::Entity);

        let attr = store
            .create_node(&entity.id.0, "attribute", "BEng Mathematics and CS", None, None)
            .unwrap();
        assert_eq!(attr.node_type, NodeType::Attribute);

        let event = store
            .create_node(&entity.id.0, "event", "Started Sep 2024", None, None)
            .unwrap();
        assert_eq!(event.node_type, NodeType::Event);

        let collection = store
            .create_node(&cat.id.0, "collection", "Programming Languages", None, None)
            .unwrap();
        assert_eq!(collection.node_type, NodeType::Collection);

        let detail = store
            .create_node(&attr.id.0, "detail", "Joint degree between Maths and CS", None, None)
            .unwrap();
        assert_eq!(detail.node_type, NodeType::Detail);

        // Verify hierarchy: root -> cat -> entity -> attr -> detail
        let ctx = store.get_context(&detail.id.0, Some(0)).unwrap();
        assert_eq!(ctx.ancestors.len(), 4); // attr, entity, cat, root
    }

    #[test]
    fn test_persistence() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        drop(tmp);
        let _ = std::fs::remove_file(&path);

        // Create and populate
        {
            let mut store = GraphStore::open(&path).unwrap();
            store
                .create_node("root", "category", "Persistent", None, None)
                .unwrap();
        }

        // Reopen and verify
        {
            let store = GraphStore::open(&path).unwrap();
            assert_eq!(store.graph.nodes.len(), 2);
            let found = store.graph.nodes.values().any(|n| n.content == "Persistent");
            assert!(found);
        }

        let _ = std::fs::remove_file(&path);
    }
}
