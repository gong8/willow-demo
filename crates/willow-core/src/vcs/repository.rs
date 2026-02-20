use crate::error::WillowError;
use crate::model::Graph;
use crate::vcs::diff::{compute_graph_diff, ChangeSummary};
use crate::vcs::merge::{
    apply_resolutions, find_merge_base, is_ancestor, three_way_merge, ConflictResolution,
    MergeConflict, MergeResult,
};
use crate::vcs::object_store::ObjectStore;
use crate::vcs::types::*;
use chrono::Utc;
use std::path::{Path, PathBuf};
use tracing::{info, debug};

/// High-level VCS repository managing commits, branches, and history.
pub struct Repository {
    store: ObjectStore,
    config: RepoConfig,
    #[allow(dead_code)]
    repo_path: PathBuf,
}

/// A branch info entry.
#[derive(Debug, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub head: CommitHash,
    pub is_current: bool,
}

impl Repository {
    /// Initialize a new repository next to the graph file.
    pub fn init(graph_dir: &Path, graph: &Graph) -> Result<Self, WillowError> {
        let repo_path = graph_dir.join("repo");
        if repo_path.exists() {
            return Err(WillowError::VcsAlreadyInitialized);
        }

        let store = ObjectStore::new(&repo_path);
        store.init()?;

        let config = RepoConfig::default();
        store.write_config(&config)?;

        // Create initial snapshot commit
        let commit_data = CommitData {
            parents: vec![],
            message: "Initial snapshot".to_string(),
            timestamp: Utc::now(),
            source: CommitSource::Migration,
            storage_type: CommitStorageType::Snapshot,
            depth_since_snapshot: 0,
        };
        let hash = ObjectStore::hash_commit(&commit_data);
        store.write_commit(&hash, &commit_data)?;
        store.write_snapshot(&hash, graph)?;

        // Set up main branch and HEAD
        store.write_branch_ref(&config.default_branch, &hash)?;
        store.write_head(&HeadState::Branch(config.default_branch.clone()))?;

        info!("VCS repository initialized");
        Ok(Repository {
            store,
            config,
            repo_path,
        })
    }

    /// Open an existing repository.
    pub fn open(graph_dir: &Path) -> Result<Self, WillowError> {
        let repo_path = graph_dir.join("repo");
        if !repo_path.exists() {
            return Err(WillowError::VcsNotInitialized);
        }

        let store = ObjectStore::new(&repo_path);
        let config = store.read_config()?;

        Ok(Repository {
            store,
            config,
            repo_path,
        })
    }

    /// Check if a repo exists at the given directory.
    pub fn exists(graph_dir: &Path) -> bool {
        graph_dir.join("repo").exists()
    }

    // ---- Internal helpers ----

    fn head_hash(&self) -> Result<CommitHash, WillowError> {
        self.store
            .resolve_head()?
            .ok_or(WillowError::VcsNotInitialized)
    }

    fn advance_head(&self, hash: &CommitHash) -> Result<(), WillowError> {
        match self.store.read_head()? {
            HeadState::Branch(name) => self.store.write_branch_ref(&name, hash),
            HeadState::Detached(_) => self.store.write_head(&HeadState::Detached(hash.clone())),
        }
    }

    fn write_snapshot_commit(
        &self,
        parents: Vec<CommitHash>,
        message: String,
        source: CommitSource,
        graph: &Graph,
    ) -> Result<CommitHash, WillowError> {
        let commit_data = CommitData {
            parents,
            message,
            timestamp: Utc::now(),
            source,
            storage_type: CommitStorageType::Snapshot,
            depth_since_snapshot: 0,
        };
        let hash = ObjectStore::hash_commit(&commit_data);
        self.store.write_commit(&hash, &commit_data)?;
        self.store.write_snapshot(&hash, graph)?;
        Ok(hash)
    }

    fn read_parents(&self, h: &CommitHash) -> Vec<CommitHash> {
        self.store
            .read_commit(h)
            .map(|d| d.parents)
            .unwrap_or_default()
    }

    fn require_branch_ref(&self, name: &str) -> Result<CommitHash, WillowError> {
        self.store
            .read_branch_ref(name)?
            .ok_or_else(|| WillowError::BranchNotFound(name.to_string()))
    }

    fn require_current_branch(&self) -> Result<String, WillowError> {
        self.current_branch()?
            .ok_or(WillowError::VcsNotInitialized)
    }

    fn merge_context(
        &self,
        source_branch: &str,
    ) -> Result<(String, CommitHash, CommitHash), WillowError> {
        let current_branch_name = self.require_current_branch()?;
        let source_hash = self.require_branch_ref(source_branch)?;
        let target_hash = self.head_hash()?;
        Ok((current_branch_name, source_hash, target_hash))
    }

    fn commit_merge(
        &self,
        target_hash: CommitHash,
        source_hash: CommitHash,
        source_branch: &str,
        current_branch_name: &str,
        message: String,
        graph: &Graph,
    ) -> Result<CommitHash, WillowError> {
        let hash = self.write_snapshot_commit(
            vec![target_hash, source_hash],
            message,
            CommitSource::Merge {
                source_branch: source_branch.to_string(),
                target_branch: current_branch_name.to_string(),
            },
            graph,
        )?;
        self.store.write_branch_ref(current_branch_name, &hash)?;
        Ok(hash)
    }

    // ---- Commit operations ----

    /// Create a commit from pending changes. Returns the new commit hash.
    pub fn create_commit(
        &self,
        input: &CommitInput,
        pending_changes: &[Change],
        current_graph: &Graph,
    ) -> Result<CommitHash, WillowError> {
        if pending_changes.is_empty() {
            return Err(WillowError::NothingToCommit);
        }

        let head_hash = self.head_hash()?;
        let parent_data = self.store.read_commit(&head_hash)?;
        let depth = parent_data.depth_since_snapshot + 1;
        let is_snapshot = depth >= self.config.snapshot_interval;

        let storage_type = if is_snapshot {
            CommitStorageType::Snapshot
        } else {
            CommitStorageType::Delta
        };

        let commit_data = CommitData {
            parents: vec![head_hash],
            message: input.message.clone(),
            timestamp: Utc::now(),
            source: input.source.clone(),
            storage_type,
            depth_since_snapshot: if is_snapshot { 0 } else { depth },
        };

        let hash = ObjectStore::hash_commit(&commit_data);
        info!(message = %input.message, storage_type = ?storage_type, "commit created");
        self.store.write_commit(&hash, &commit_data)?;

        if is_snapshot {
            self.store.write_snapshot(&hash, current_graph)?;
        } else {
            self.store.write_delta(
                &hash,
                &Delta {
                    changes: pending_changes.to_vec(),
                },
            )?;
        }

        self.advance_head(&hash)?;
        Ok(hash)
    }

    /// Reconstruct graph at a specific commit by finding nearest snapshot and replaying deltas.
    pub fn reconstruct_at(&self, target_hash: &CommitHash) -> Result<Graph, WillowError> {
        let mut chain: Vec<CommitHash> = Vec::new();
        let mut current = target_hash.clone();

        loop {
            let data = self.store.read_commit(&current)?;
            if data.storage_type == CommitStorageType::Snapshot {
                let mut graph = self.store.read_snapshot(&current)?;
                debug!(target = %target_hash.0, chain_len = chain.len(), "reconstructing graph");
                for hash in chain.iter().rev() {
                    let delta = self.store.read_delta(hash)?;
                    apply_delta(&mut graph, &delta);
                }
                return Ok(graph);
            }
            chain.push(current.clone());
            if data.parents.is_empty() {
                return Err(WillowError::VcsCommitNotFound(
                    "No snapshot found in commit chain".to_string(),
                ));
            }
            current = data.parents[0].clone();
        }
    }

    /// Get commit log (most recent first).
    pub fn log(&self, limit: Option<usize>) -> Result<Vec<CommitEntry>, WillowError> {
        let Some(head) = self.store.resolve_head()? else {
            return Ok(Vec::new());
        };

        let max = limit.unwrap_or(50);
        let mut entries = Vec::new();
        let mut current = Some(head);

        while let Some(hash) = current {
            if entries.len() >= max {
                break;
            }
            let data = self.store.read_commit(&hash)?;
            let parent = data.parents.first().cloned();
            entries.push(CommitEntry { hash, data });
            current = parent;
        }

        Ok(entries)
    }

    /// Show diff for a specific commit (compare with parent).
    pub fn show_commit(
        &self,
        hash: &CommitHash,
    ) -> Result<(CommitData, ChangeSummary), WillowError> {
        let data = self.store.read_commit(hash)?;

        let current_graph = self.reconstruct_at(hash)?;
        let parent_graph = match data.parents.first() {
            Some(parent_hash) => self.reconstruct_at(parent_hash)?,
            None => Graph::empty(current_graph.root_id.clone()),
        };

        let diff = compute_graph_diff(&parent_graph, &current_graph);
        Ok((data, diff))
    }

    /// Diff between two arbitrary commits.
    pub fn diff(
        &self,
        from_hash: &CommitHash,
        to_hash: &CommitHash,
    ) -> Result<ChangeSummary, WillowError> {
        let from_graph = self.reconstruct_at(from_hash)?;
        let to_graph = self.reconstruct_at(to_hash)?;
        Ok(compute_graph_diff(&from_graph, &to_graph))
    }

    /// Create a snapshot commit if the current graph differs from HEAD.
    /// Used when changes were made externally (e.g. by a subprocess) and
    /// in-memory pending_changes are not available.
    pub fn commit_if_changed(
        &self,
        input: &CommitInput,
        current_graph: &Graph,
    ) -> Result<Option<CommitHash>, WillowError> {
        let head_hash = self.head_hash()?;
        let committed_graph = self.reconstruct_at(&head_hash)?;
        let diff = compute_graph_diff(&committed_graph, current_graph);

        if diff.is_empty() {
            return Ok(None);
        }

        let hash = self.write_snapshot_commit(
            vec![head_hash],
            input.message.clone(),
            input.source.clone(),
            current_graph,
        )?;
        self.advance_head(&hash)?;
        Ok(Some(hash))
    }

    // ---- Branch operations ----

    /// Get current branch name (None if detached).
    pub fn current_branch(&self) -> Result<Option<String>, WillowError> {
        match self.store.read_head()? {
            HeadState::Branch(name) => Ok(Some(name)),
            HeadState::Detached(_) => Ok(None),
        }
    }

    /// List all branches with their head commits.
    pub fn list_branches(&self) -> Result<Vec<BranchInfo>, WillowError> {
        let branches = self.store.list_branches()?;
        let current = self.current_branch()?;
        let mut result = Vec::new();

        for name in branches {
            if let Some(hash) = self.store.read_branch_ref(&name)? {
                result.push(BranchInfo {
                    is_current: current.as_deref() == Some(&name),
                    name,
                    head: hash,
                });
            }
        }

        Ok(result)
    }

    /// Create a new branch at current HEAD.
    pub fn create_branch(&self, name: &str) -> Result<(), WillowError> {
        if self.store.read_branch_ref(name)?.is_some() {
            return Err(WillowError::BranchAlreadyExists(name.to_string()));
        }

        let head = self.head_hash()?;
        self.store.write_branch_ref(name, &head)?;
        Ok(())
    }

    /// Switch to a branch. Returns the reconstructed graph state for that branch.
    pub fn switch_branch(
        &self,
        name: &str,
        has_pending_changes: bool,
    ) -> Result<Graph, WillowError> {
        info!(branch = %name, "switching branch");
        if has_pending_changes {
            return Err(WillowError::HasPendingChanges);
        }

        let branch_hash = self.require_branch_ref(name)?;
        let graph = self.reconstruct_at(&branch_hash)?;
        self.store
            .write_head(&HeadState::Branch(name.to_string()))?;

        Ok(graph)
    }

    /// Delete a branch.
    pub fn delete_branch(&self, name: &str) -> Result<(), WillowError> {
        self.require_branch_ref(name)?;

        if name == self.config.default_branch {
            return Err(WillowError::CannotDeleteDefaultBranch(name.to_string()));
        }

        if self.current_branch()?.as_deref() == Some(name) {
            return Err(WillowError::CannotDeleteCurrentBranch(name.to_string()));
        }

        self.store.delete_branch_ref(name)?;
        Ok(())
    }

    /// Checkout a specific commit (detached HEAD). Returns reconstructed graph.
    pub fn checkout_commit(
        &self,
        hash: &CommitHash,
        has_pending_changes: bool,
    ) -> Result<Graph, WillowError> {
        if has_pending_changes {
            return Err(WillowError::HasPendingChanges);
        }

        self.store.read_commit(hash)?;
        let graph = self.reconstruct_at(hash)?;
        self.store.write_head(&HeadState::Detached(hash.clone()))?;

        Ok(graph)
    }

    /// Restore graph to a past commit state (creates a new commit on current branch).
    pub fn restore_to_commit(
        &self,
        hash: &CommitHash,
        _current_graph: &Graph,
    ) -> Result<(CommitHash, Graph), WillowError> {
        let target_graph = self.reconstruct_at(hash)?;
        let head_hash = self.head_hash()?;

        let new_hash = self.write_snapshot_commit(
            vec![head_hash],
            format!("Restore to {}", &hash.0[..8.min(hash.0.len())]),
            CommitSource::Manual {
                tool_name: Some("restore".to_string()),
            },
            &target_graph,
        )?;
        self.advance_head(&new_hash)?;

        Ok((new_hash, target_graph))
    }

    /// Merge a source branch into the current branch.
    /// Returns Ok with the new graph on success or fast-forward,
    /// or Err with conflicts.
    pub fn merge_branch(
        &self,
        source_branch: &str,
        current_graph: &Graph,
    ) -> Result<MergeBranchResult, WillowError> {
        info!(source = %source_branch, "merging branch");
        let (current_branch_name, source_hash, target_hash) =
            self.merge_context(source_branch)?;

        let read_parents = |h: &CommitHash| self.read_parents(h);

        if is_ancestor(&target_hash, &source_hash, &read_parents) {
            self.store
                .write_branch_ref(&current_branch_name, &source_hash)?;
            let graph = self.reconstruct_at(&source_hash)?;
            return Ok(MergeBranchResult::Success(source_hash, graph));
        }

        let merge_base_hash = find_merge_base(&target_hash, &source_hash, &read_parents)
            .ok_or_else(|| {
                WillowError::VcsCommitNotFound("No common ancestor found".to_string())
            })?;

        let base_graph = self.reconstruct_at(&merge_base_hash)?;
        let theirs_graph = self.reconstruct_at(&source_hash)?;

        match three_way_merge(&base_graph, current_graph, &theirs_graph) {
            MergeResult::Success(merged_graph) => {
                let hash = self.commit_merge(
                    target_hash,
                    source_hash,
                    source_branch,
                    &current_branch_name,
                    format!("Merge '{}' into '{}'", source_branch, current_branch_name),
                    &merged_graph,
                )?;
                Ok(MergeBranchResult::Success(hash, merged_graph))
            }
            MergeResult::FastForward(hash) => {
                let graph = self.reconstruct_at(&hash)?;
                Ok(MergeBranchResult::Success(hash, graph))
            }
            MergeResult::Conflicts(conflicts) => Ok(MergeBranchResult::Conflicts {
                conflicts,
                source_branch: source_branch.to_string(),
            }),
        }
    }

    /// Complete a merge after resolving conflicts.
    pub fn resolve_conflicts(
        &self,
        resolutions: &[ConflictResolution],
        source_branch: &str,
        current_graph: &Graph,
    ) -> Result<(CommitHash, Graph), WillowError> {
        let (current_branch_name, source_hash, target_hash) =
            self.merge_context(source_branch)?;

        let mut resolved_graph = current_graph.clone();
        apply_resolutions(&mut resolved_graph, resolutions);

        let hash = self.commit_merge(
            target_hash,
            source_hash,
            source_branch,
            &current_branch_name,
            format!(
                "Merge '{}' into '{}' (conflicts resolved)",
                source_branch, current_branch_name
            ),
            &resolved_graph,
        )?;

        Ok((hash, resolved_graph))
    }
}

#[derive(Debug)]
pub enum MergeBranchResult {
    Success(CommitHash, Graph),
    Conflicts {
        conflicts: Vec<MergeConflict>,
        source_branch: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn test_graph() -> Graph {
        let root_id = NodeId("root".to_string());
        let mut nodes = HashMap::new();
        let now = Utc::now();
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
                created_at: now,
                updated_at: now,
            },
        );
        Graph {
            root_id,
            nodes,
            links: HashMap::new(),
        }
    }

    fn test_node(id: &str, content: &str) -> Node {
        let now = Utc::now();
        Node {
            id: NodeId(id.to_string()),
            node_type: NodeType::Detail,
            content: content.to_string(),
            parent_id: Some(NodeId("root".to_string())),
            children: Vec::new(),
            metadata: HashMap::new(),
            previous_values: Vec::new(),
            temporal: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn add_node_to_graph(graph: &mut Graph, id: &str, content: &str) -> Node {
        let nid = NodeId(id.to_string());
        let node = test_node(id, content);
        graph.nodes.insert(nid.clone(), node.clone());
        graph
            .nodes
            .get_mut(&NodeId("root".to_string()))
            .unwrap()
            .children
            .push(nid);
        node
    }

    fn commit_input(message: &str) -> CommitInput {
        CommitInput {
            message: message.to_string(),
            source: CommitSource::Manual { tool_name: None },
        }
    }

    fn commit_node(
        repo: &Repository,
        graph: &mut Graph,
        id: &str,
        content: &str,
        message: &str,
    ) -> CommitHash {
        let node = add_node_to_graph(graph, id, content);
        let nid = NodeId(id.to_string());
        repo.create_commit(
            &commit_input(message),
            &[Change::CreateNode {
                node_id: nid,
                node,
            }],
            graph,
        )
        .unwrap()
    }

    fn init_repo() -> (TempDir, Repository, Graph) {
        let dir = TempDir::new().unwrap();
        let graph = test_graph();
        let repo = Repository::init(dir.path(), &graph).unwrap();
        (dir, repo, graph)
    }

    #[test]
    fn test_init_and_open() {
        let (dir, _repo, _graph) = init_repo();
        assert!(Repository::exists(dir.path()));
        let repo2 = Repository::open(dir.path()).unwrap();
        assert_eq!(repo2.current_branch().unwrap(), Some("main".to_string()));
    }

    #[test]
    fn test_init_twice_fails() {
        let (dir, _repo, graph) = init_repo();
        assert!(Repository::init(dir.path(), &graph).is_err());
    }

    #[test]
    fn test_commit_and_log() {
        let (_dir, repo, mut graph) = init_repo();
        let hash = commit_node(&repo, &mut graph, "n1", "Test node", "Add test node");

        let log = repo.log(None).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].hash, hash);
        assert_eq!(log[0].data.message, "Add test node");
        assert_eq!(log[1].data.message, "Initial snapshot");

        assert!(matches!(&log[0].data.source, CommitSource::Manual { tool_name } if tool_name.is_none()));
        assert!(matches!(&log[1].data.source, CommitSource::Migration));
    }

    #[test]
    fn test_reconstruct() {
        let (_dir, repo, mut graph) = init_repo();
        let nid = NodeId("n1".to_string());
        let hash = commit_node(&repo, &mut graph, "n1", "Reconstructed", "Test");

        let reconstructed = repo.reconstruct_at(&hash).unwrap();
        assert!(reconstructed.nodes.contains_key(&nid));
        assert_eq!(reconstructed.nodes.get(&nid).unwrap().content, "Reconstructed");
    }

    #[test]
    fn test_show_commit() {
        let (_dir, repo, mut graph) = init_repo();
        let hash = commit_node(&repo, &mut graph, "n1", "New node", "Add node");

        let (data, diff) = repo.show_commit(&hash).unwrap();
        assert_eq!(data.message, "Add node");
        assert_eq!(diff.nodes_created.len(), 1);
    }

    #[test]
    fn test_branches() {
        let (_dir, repo, _graph) = init_repo();

        repo.create_branch("experiment").unwrap();
        assert_eq!(repo.list_branches().unwrap().len(), 2);

        assert!(repo.create_branch("experiment").is_err());

        repo.delete_branch("experiment").unwrap();
        assert_eq!(repo.list_branches().unwrap().len(), 1);

        assert!(repo.delete_branch("main").is_err());
    }

    #[test]
    fn test_switch_branch() {
        let (_dir, repo, mut graph) = init_repo();
        repo.create_branch("experiment").unwrap();

        commit_node(&repo, &mut graph, "on-main", "Main branch node", "Main commit");

        let exp_graph = repo.switch_branch("experiment", false).unwrap();
        assert!(!exp_graph.nodes.contains_key(&NodeId("on-main".to_string())));

        let main_graph = repo.switch_branch("main", false).unwrap();
        assert!(main_graph.nodes.contains_key(&NodeId("on-main".to_string())));
    }

    #[test]
    fn test_switch_branch_with_pending_changes_fails() {
        let (_dir, repo, _graph) = init_repo();
        repo.create_branch("experiment").unwrap();
        assert!(repo.switch_branch("experiment", true).is_err());
    }

    #[test]
    fn test_nothing_to_commit() {
        let (_dir, repo, graph) = init_repo();
        assert!(repo.create_commit(&commit_input("Empty"), &[], &graph).is_err());
    }

    #[test]
    fn test_merge_fast_forward() {
        let (_dir, repo, _graph) = init_repo();

        repo.create_branch("feature").unwrap();
        let mut feature_graph = repo.switch_branch("feature", false).unwrap();

        commit_node(&repo, &mut feature_graph, "feat-node", "Feature", "Feature commit");

        let main_graph = repo.switch_branch("main", false).unwrap();
        let result = repo.merge_branch("feature", &main_graph).unwrap();

        match result {
            MergeBranchResult::Success(_, merged) => {
                assert!(merged.nodes.contains_key(&NodeId("feat-node".to_string())));
            }
            _ => panic!("Expected fast-forward success"),
        }
    }

    #[test]
    fn test_checkout_and_restore() {
        let (_dir, repo, mut graph) = init_repo();

        let log = repo.log(None).unwrap();
        let initial_hash = log[0].hash.clone();

        commit_node(&repo, &mut graph, "n1", "Will be restored", "Add node");

        let (_restore_hash, restored_graph) =
            repo.restore_to_commit(&initial_hash, &graph).unwrap();
        assert!(!restored_graph.nodes.contains_key(&NodeId("n1".to_string())));

        let log = repo.log(None).unwrap();
        assert_eq!(log.len(), 3);
        assert!(log[0].data.message.contains("Restore"));
    }
}
