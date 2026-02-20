use crate::error::WillowError;
use crate::model::*;
use crate::search;
use crate::storage;
use crate::vcs::repository::Repository;
use crate::vcs::types::{Change, CommitInput};
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use tracing::{info, debug};

pub struct ContextResult {
    pub node: Node,
    pub ancestors: Vec<Node>,
    pub descendants: Vec<Node>,
    pub links: Vec<Link>,
}

pub struct GraphStore {
    pub graph: Graph,
    pub path: PathBuf,
    pub repo: Option<Repository>,
    pending_changes: Vec<Change>,
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

        // Try to open existing VCS repo
        let repo = if let Some(parent) = path.parent() {
            Repository::open(parent).ok()
        } else {
            None
        };

        info!(path = %path.display(), nodes = graph.nodes.len(), vcs = repo.is_some(), "store opened");
        Ok(GraphStore {
            graph,
            path: path.to_path_buf(),
            repo,
            pending_changes: Vec::new(),
        })
    }

    fn save(&self) -> Result<(), WillowError> {
        storage::save_graph(&self.path, &self.graph)
    }

    fn record_change(&mut self, change: Change) {
        if self.repo.is_some() {
            self.pending_changes.push(change);
        }
    }

    fn require_repo(&self) -> Result<&Repository, WillowError> {
        self.repo.as_ref().ok_or(WillowError::VcsNotInitialized)
    }

    fn apply_graph(&mut self, graph: Graph) -> Result<(), WillowError> {
        self.graph = graph;
        self.save()?;
        self.pending_changes.clear();
        Ok(())
    }

    fn get_node(&self, node_id: &str) -> Result<&Node, WillowError> {
        let nid = NodeId(node_id.to_string());
        self.graph
            .nodes
            .get(&nid)
            .ok_or_else(|| WillowError::NodeNotFound(node_id.to_string()))
    }

    fn links_touching(&self, node_ids: &std::collections::HashSet<&NodeId>) -> Vec<Link> {
        self.graph
            .links
            .values()
            .filter(|link| {
                node_ids.contains(&link.from_node) || node_ids.contains(&link.to_node)
            })
            .cloned()
            .collect()
    }

    // ---- VCS methods ----

    pub fn vcs_init(&mut self) -> Result<(), WillowError> {
        let graph_dir = self
            .path
            .parent()
            .ok_or_else(|| WillowError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "No parent directory for graph file",
            )))?;

        let repo = Repository::init(graph_dir, &self.graph)?;
        self.repo = Some(repo);
        Ok(())
    }

    pub fn has_pending_changes(&self) -> bool {
        !self.pending_changes.is_empty()
    }

    pub fn pending_changes(&self) -> &[Change] {
        &self.pending_changes
    }

    pub fn commit(&mut self, input: CommitInput) -> Result<crate::vcs::types::CommitHash, WillowError> {
        let repo = self.require_repo()?;
        let hash = repo.create_commit(&input, &self.pending_changes, &self.graph)?;
        self.pending_changes.clear();
        Ok(hash)
    }

    /// Commit if the graph on disk differs from the last committed state.
    /// Used after external processes modify the graph file.
    pub fn commit_external_changes(&self, input: CommitInput) -> Result<Option<crate::vcs::types::CommitHash>, WillowError> {
        self.require_repo()?.commit_if_changed(&input, &self.graph)
    }

    pub fn discard_changes(&mut self) -> Result<(), WillowError> {
        let repo = self.require_repo()?;
        if let Some(head) = repo.log(Some(1))?.first() {
            let graph = repo.reconstruct_at(&head.hash)?;
            self.apply_graph(graph)?;
        } else {
            self.pending_changes.clear();
        }
        Ok(())
    }

    pub fn get_repo(&self) -> Result<&Repository, WillowError> {
        self.require_repo()
    }

    /// Switch branch — replaces the in-memory graph and saves to disk.
    pub fn switch_branch(&mut self, name: &str) -> Result<(), WillowError> {
        let graph = self.require_repo()?.switch_branch(name, self.has_pending_changes())?;
        self.apply_graph(graph)
    }

    /// Checkout a specific commit (detached HEAD).
    pub fn checkout_commit(&mut self, hash: &crate::vcs::types::CommitHash) -> Result<(), WillowError> {
        let graph = self.require_repo()?.checkout_commit(hash, self.has_pending_changes())?;
        self.apply_graph(graph)
    }

    /// Restore to a past commit (creates a new commit).
    pub fn restore_to_commit(&mut self, hash: &crate::vcs::types::CommitHash) -> Result<crate::vcs::types::CommitHash, WillowError> {
        let (new_hash, graph) = self.require_repo()?.restore_to_commit(hash, &self.graph)?;
        self.apply_graph(graph)?;
        Ok(new_hash)
    }

    /// Merge a source branch into current. Returns Ok(hash) on success.
    pub fn merge_branch(&mut self, source: &str) -> Result<crate::vcs::types::CommitHash, WillowError> {
        match self.require_repo()?.merge_branch(source, &self.graph)? {
            crate::vcs::repository::MergeBranchResult::Success(hash, graph) => {
                self.apply_graph(graph)?;
                Ok(hash)
            }
            crate::vcs::repository::MergeBranchResult::Conflicts { conflicts, .. } => {
                Err(WillowError::MergeConflict(conflicts.len()))
            }
        }
    }

    // ---- Mutation methods ----

    pub fn create_node(
        &mut self,
        parent_id: &str,
        node_type: &str,
        content: &str,
        metadata: Option<HashMap<String, String>>,
        temporal: Option<TemporalMetadata>,
    ) -> Result<Node, WillowError> {
        debug!(parent = %parent_id, node_type = %node_type, "create_node");
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

        self.graph.nodes.insert(node_id.clone(), node.clone());
        self.save()?;

        self.record_change(Change::CreateNode {
            node_id,
            node: node.clone(),
        });

        Ok(node)
    }

    pub fn get_context(
        &self,
        node_id: &str,
        depth: Option<u32>,
    ) -> Result<ContextResult, WillowError> {
        let node = self.get_node(node_id)?.clone();
        let nid = &node.id;

        let ancestors = self.collect_ancestors(nid);

        let max_depth = depth.unwrap_or(2);
        let mut descendants = Vec::new();
        self.collect_descendants(nid, max_depth, 0, &mut descendants);

        let mut involved_ids: std::collections::HashSet<&NodeId> = std::collections::HashSet::new();
        involved_ids.insert(nid);
        for a in &ancestors {
            involved_ids.insert(&a.id);
        }
        for d in &descendants {
            involved_ids.insert(&d.id);
        }

        let links = self.links_touching(&involved_ids);

        Ok(ContextResult {
            node,
            ancestors,
            descendants,
            links,
        })
    }

    fn collect_ancestors(&self, node_id: &NodeId) -> Vec<Node> {
        let mut ancestors = Vec::new();
        let mut current_id = self.graph.nodes.get(node_id).and_then(|n| n.parent_id.clone());
        while let Some(pid) = current_id {
            if let Some(parent) = self.graph.nodes.get(&pid) {
                ancestors.push(parent.clone());
                current_id = parent.parent_id.clone();
            } else {
                break;
            }
        }
        ancestors
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
        debug!(node_id = %node_id, "update_node");
        let nid = NodeId(node_id.to_string());

        let (old_content, old_metadata) = {
            let node = self.get_node(node_id)?;
            (node.content.clone(), node.metadata.clone())
        };

        let node = self
            .graph
            .nodes
            .get_mut(&nid)
            .unwrap();

        let mut content_changed = false;
        let mut metadata_changed = false;

        if let Some(new_content) = content {
            if new_content != node.content {
                // Push old content to previous_values
                node.previous_values.push(SupersededValue {
                    old_content: node.content.clone(),
                    superseded_at: Utc::now(),
                    reason: reason.map(|s| s.to_string()),
                });
                node.content = new_content.to_string();
                content_changed = true;
            }
        }

        if let Some(new_metadata) = &metadata {
            if *new_metadata != node.metadata {
                metadata_changed = true;
            }
            node.metadata = new_metadata.clone();
        }

        if let Some(new_temporal) = temporal {
            node.temporal = Some(new_temporal);
        }

        node.updated_at = Utc::now();

        let updated = node.clone();
        self.save()?;

        if content_changed || metadata_changed {
            self.record_change(Change::UpdateNode {
                node_id: nid,
                old_content: if content_changed { Some(old_content) } else { None },
                new_content: if content_changed { Some(updated.content.clone()) } else { None },
                old_metadata: if metadata_changed { Some(old_metadata) } else { None },
                new_metadata: if metadata_changed { Some(updated.metadata.clone()) } else { None },
            });
        }

        Ok(updated)
    }

    pub fn delete_node(&mut self, node_id: &str) -> Result<(), WillowError> {
        let nid = NodeId(node_id.to_string());

        if nid == self.graph.root_id {
            return Err(WillowError::CannotDeleteRoot);
        }

        self.get_node(node_id)?;

        let mut to_delete = Vec::new();
        self.collect_descendant_ids(&nid, &mut to_delete);
        to_delete.push(nid.clone());
        debug!(node_id = %node_id, cascade = to_delete.len(), "delete_node");

        let deleted_nodes: Vec<Node> = to_delete
            .iter()
            .filter_map(|id| self.graph.nodes.get(id).cloned())
            .collect();
        let delete_set: std::collections::HashSet<&NodeId> = to_delete.iter().collect();
        let deleted_links = self.links_touching(&delete_set);

        if let Some(parent_id) = self.graph.nodes.get(&nid).and_then(|n| n.parent_id.clone()) {
            if let Some(parent) = self.graph.nodes.get_mut(&parent_id) {
                parent.children.retain(|c| c != &nid);
            }
        }

        for id in &to_delete {
            self.graph.nodes.remove(id);
        }

        self.graph
            .links
            .retain(|_, link| !delete_set.contains(&link.from_node) && !delete_set.contains(&link.to_node));

        self.save()?;

        self.record_change(Change::DeleteNode {
            node_id: nid,
            deleted_nodes,
            deleted_links,
        });

        Ok(())
    }

    fn collect_descendant_ids(&self, node_id: &NodeId, result: &mut Vec<NodeId>) {
        if let Some(node) = self.graph.nodes.get(node_id) {
            for child_id in &node.children {
                result.push(child_id.clone());
                self.collect_descendant_ids(child_id, result);
            }
        }
    }

    pub fn add_link(
        &mut self,
        from_node: &str,
        to_node: &str,
        relation: &str,
        bidirectional: bool,
        confidence: Option<&str>,
    ) -> Result<Link, WillowError> {
        debug!(from = %from_node, to = %to_node, relation = %relation, "add_link");
        let from_nid = NodeId(from_node.to_string());
        let to_nid = NodeId(to_node.to_string());

        self.get_node(from_node)?;
        self.get_node(to_node)?;

        let confidence_level = confidence
            .map(|s| ConfidenceLevel::from_str(s).ok_or_else(|| WillowError::InvalidConfidence(s.to_string())))
            .transpose()?;

        // Check for duplicate — also check reverse direction when bidirectional
        let is_dup = self.graph.links.values().any(|link| {
            let forward = link.from_node == from_nid && link.to_node == to_nid && link.relation == relation;
            let reverse = bidirectional
                && link.from_node == to_nid
                && link.to_node == from_nid
                && link.relation == relation;
            forward || reverse
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
            bidirectional,
            confidence: confidence_level,
            created_at: Utc::now(),
        };

        self.graph.links.insert(link.id.clone(), link.clone());
        self.save()?;

        self.record_change(Change::AddLink {
            link_id: link.id.clone(),
            link: link.clone(),
        });

        Ok(link)
    }

    pub fn update_link(
        &mut self,
        link_id: &str,
        relation: Option<&str>,
        bidirectional: Option<bool>,
        confidence: Option<&str>,
    ) -> Result<Link, WillowError> {
        debug!(link_id = %link_id, "update_link");
        let lid = LinkId(link_id.to_string());

        let old_link = self
            .graph
            .links
            .get(&lid)
            .ok_or_else(|| WillowError::LinkNotFound(link_id.to_string()))?
            .clone();

        let confidence_level = confidence
            .map(|s| ConfidenceLevel::from_str(s).ok_or_else(|| WillowError::InvalidConfidence(s.to_string())))
            .transpose()?;

        let link = self.graph.links.get_mut(&lid).unwrap();

        if let Some(r) = relation {
            link.relation = r.to_string();
        }
        if let Some(b) = bidirectional {
            link.bidirectional = b;
        }
        if let Some(c) = confidence_level {
            link.confidence = Some(c);
        }

        let new_link = link.clone();
        self.save()?;

        self.record_change(Change::UpdateLink {
            link_id: lid,
            old_link,
            new_link: new_link.clone(),
        });

        Ok(new_link)
    }

    pub fn delete_link(&mut self, link_id: &str) -> Result<Link, WillowError> {
        debug!(link_id = %link_id, "delete_link");
        let lid = LinkId(link_id.to_string());

        let link = self
            .graph
            .links
            .remove(&lid)
            .ok_or_else(|| WillowError::LinkNotFound(link_id.to_string()))?;

        self.save()?;

        self.record_change(Change::RemoveLink {
            link_id: lid,
            link: link.clone(),
        });

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
        let _link = store.add_link(&cat.id.0, &detail.id.0, "includes", false, None).unwrap();

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
        let link = store.add_link(&a.id.0, &b.id.0, "related_to", false, None).unwrap();

        assert_eq!(link.from_node, a.id);
        assert_eq!(link.to_node, b.id);
        assert_eq!(link.relation, "related_to");
        assert!(!link.bidirectional);
        assert!(link.confidence.is_none());
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
        store.add_link(&a.id.0, &b.id.0, "related_to", false, None).unwrap();
        let result = store.add_link(&a.id.0, &b.id.0, "related_to", false, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_add_link_with_confidence() {
        let mut store = temp_store();
        let a = store.create_node("root", "category", "A", None, None).unwrap();
        let b = store.create_node("root", "category", "B", None, None).unwrap();

        let link = store.add_link(&a.id.0, &b.id.0, "caused_by", true, Some("high")).unwrap();
        assert!(link.bidirectional);
        assert_eq!(link.confidence, Some(ConfidenceLevel::High));
    }

    #[test]
    fn test_bidirectional_duplicate_detection() {
        let mut store = temp_store();
        let a = store.create_node("root", "category", "A", None, None).unwrap();
        let b = store.create_node("root", "category", "B", None, None).unwrap();

        // Create A->B bidirectional
        store.add_link(&a.id.0, &b.id.0, "related_to", true, None).unwrap();

        // B->A with same relation should be rejected when creating as bidirectional
        let result = store.add_link(&b.id.0, &a.id.0, "related_to", true, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_link() {
        let mut store = temp_store();
        let a = store.create_node("root", "category", "A", None, None).unwrap();
        let b = store.create_node("root", "category", "B", None, None).unwrap();

        let link = store.add_link(&a.id.0, &b.id.0, "related_to", false, None).unwrap();

        let updated = store.update_link(&link.id.0, Some("caused_by"), Some(true), Some("high")).unwrap();
        assert_eq!(updated.relation, "caused_by");
        assert!(updated.bidirectional);
        assert_eq!(updated.confidence, Some(ConfidenceLevel::High));

        // Partial update
        let updated2 = store.update_link(&link.id.0, None, None, Some("low")).unwrap();
        assert_eq!(updated2.relation, "caused_by"); // unchanged
        assert!(updated2.bidirectional); // unchanged
        assert_eq!(updated2.confidence, Some(ConfidenceLevel::Low));
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

    #[test]
    fn test_vcs_init_and_commit() {
        let tmp = tempfile::TempDir::new().unwrap();
        let graph_path = tmp.path().join("graph.json");
        let mut store = GraphStore::open(&graph_path).unwrap();

        // No VCS initially
        assert!(store.repo.is_none());
        assert!(!store.has_pending_changes());

        // Init VCS
        store.vcs_init().unwrap();
        assert!(store.repo.is_some());

        // Make changes — should now track
        store
            .create_node("root", "detail", "VCS tracked", None, None)
            .unwrap();
        assert!(store.has_pending_changes());
        assert_eq!(store.pending_changes().len(), 1);

        // Commit
        let hash = store
            .commit(CommitInput {
                message: "First tracked commit".to_string(),
                source: crate::vcs::types::CommitSource::Manual { tool_name: None },
            })
            .unwrap();

        assert!(!store.has_pending_changes());

        // Log should have 2 entries
        let log = store.get_repo().unwrap().log(None).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].hash, hash);
    }

    #[test]
    fn test_vcs_discard_changes() {
        let tmp = tempfile::TempDir::new().unwrap();
        let graph_path = tmp.path().join("graph.json");
        let mut store = GraphStore::open(&graph_path).unwrap();
        store.vcs_init().unwrap();

        let initial_count = store.graph.nodes.len();

        // Make changes
        store
            .create_node("root", "detail", "Will be discarded", None, None)
            .unwrap();
        assert_eq!(store.graph.nodes.len(), initial_count + 1);

        // Discard
        store.discard_changes().unwrap();
        assert_eq!(store.graph.nodes.len(), initial_count);
        assert!(!store.has_pending_changes());
    }
}
