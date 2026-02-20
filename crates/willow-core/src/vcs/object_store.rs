use crate::error::WillowError;
use crate::model::Graph;
use crate::vcs::types::{CommitData, CommitHash, Delta, HeadState, RepoConfig};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use tracing::debug;

/// Manages on-disk storage of VCS objects (commits, snapshots, deltas, refs).
pub struct ObjectStore {
    repo_path: PathBuf,
}

impl ObjectStore {
    pub fn new(repo_path: &Path) -> Self {
        ObjectStore {
            repo_path: repo_path.to_path_buf(),
        }
    }

    /// Initialize the repo directory structure.
    pub fn init(&self) -> Result<(), WillowError> {
        std::fs::create_dir_all(self.commits_dir())?;
        std::fs::create_dir_all(self.snapshots_dir())?;
        std::fs::create_dir_all(self.deltas_dir())?;
        std::fs::create_dir_all(self.refs_heads_dir())?;
        Ok(())
    }

    // ---- Path helpers ----

    fn object_dir(&self, kind: &str) -> PathBuf {
        self.repo_path.join("objects").join(kind)
    }

    fn commits_dir(&self) -> PathBuf {
        self.object_dir("commits")
    }

    fn snapshots_dir(&self) -> PathBuf {
        self.object_dir("snapshots")
    }

    fn deltas_dir(&self) -> PathBuf {
        self.object_dir("deltas")
    }

    fn refs_heads_dir(&self) -> PathBuf {
        self.repo_path.join("refs").join("heads")
    }

    fn head_path(&self) -> PathBuf {
        self.repo_path.join("HEAD")
    }

    fn config_path(&self) -> PathBuf {
        self.repo_path.join("config.json")
    }

    // ---- Generic JSON helpers ----

    fn write_json<T: Serialize>(&self, path: &Path, data: &T) -> Result<(), WillowError> {
        let json = serde_json::to_string_pretty(data)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    fn read_json<T: serde::de::DeserializeOwned>(&self, path: &Path) -> Result<T, WillowError> {
        let data = std::fs::read_to_string(path)?;
        let value: T = serde_json::from_str(&data)?;
        Ok(value)
    }

    fn read_json_or_not_found<T: serde::de::DeserializeOwned>(
        &self,
        path: &Path,
        hash: &CommitHash,
    ) -> Result<T, WillowError> {
        if !path.exists() {
            return Err(WillowError::VcsCommitNotFound(hash.0.clone()));
        }
        self.read_json(path)
    }

    // ---- Config ----

    pub fn write_config(&self, config: &RepoConfig) -> Result<(), WillowError> {
        self.write_json(&self.config_path(), config)
    }

    pub fn read_config(&self) -> Result<RepoConfig, WillowError> {
        self.read_json(&self.config_path())
    }

    // ---- HEAD ----

    pub fn write_head(&self, state: &HeadState) -> Result<(), WillowError> {
        let content = match state {
            HeadState::Branch(name) => format!("ref: refs/heads/{}", name),
            HeadState::Detached(hash) => hash.0.clone(),
        };
        std::fs::write(self.head_path(), content)?;
        Ok(())
    }

    pub fn read_head(&self) -> Result<HeadState, WillowError> {
        let content = std::fs::read_to_string(self.head_path())?;
        let content = content.trim();
        if let Some(ref_path) = content.strip_prefix("ref: refs/heads/") {
            Ok(HeadState::Branch(ref_path.to_string()))
        } else {
            Ok(HeadState::Detached(CommitHash(content.to_string())))
        }
    }

    // ---- Branch refs ----

    pub fn write_branch_ref(&self, branch: &str, hash: &CommitHash) -> Result<(), WillowError> {
        let path = self.refs_heads_dir().join(branch);
        std::fs::write(path, &hash.0)?;
        Ok(())
    }

    pub fn read_branch_ref(&self, branch: &str) -> Result<Option<CommitHash>, WillowError> {
        let path = self.refs_heads_dir().join(branch);
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(path)?;
        Ok(Some(CommitHash(content.trim().to_string())))
    }

    pub fn delete_branch_ref(&self, branch: &str) -> Result<(), WillowError> {
        let path = self.refs_heads_dir().join(branch);
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn list_branches(&self) -> Result<Vec<String>, WillowError> {
        let dir = self.refs_heads_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut branches = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    branches.push(name.to_string());
                }
            }
        }
        branches.sort();
        Ok(branches)
    }

    // ---- Commit objects ----

    /// Compute content-addressed hash for a commit.
    pub fn hash_commit(data: &CommitData) -> CommitHash {
        let serialized = serde_json::to_string(data).expect("CommitData serialization");
        let mut hasher = Sha256::new();
        hasher.update(serialized.as_bytes());
        let result = hasher.finalize();
        CommitHash(format!("{:x}", result))
    }

    pub fn write_commit(&self, hash: &CommitHash, data: &CommitData) -> Result<(), WillowError> {
        debug!(hash = %hash.0, "writing commit");
        self.write_json(&self.commits_dir().join(&hash.0), data)
    }

    pub fn read_commit(&self, hash: &CommitHash) -> Result<CommitData, WillowError> {
        debug!(hash = %hash.0, "reading commit");
        self.read_json_or_not_found(&self.commits_dir().join(&hash.0), hash)
    }

    // ---- Snapshots (zstd compressed) ----

    pub fn write_snapshot(&self, hash: &CommitHash, graph: &Graph) -> Result<(), WillowError> {
        debug!(hash = %hash.0, "writing snapshot");
        let path = self.snapshots_dir().join(&hash.0);
        let json = serde_json::to_vec(graph)?;
        let compressed = zstd::encode_all(json.as_slice(), 3).map_err(WillowError::Io)?;
        std::fs::write(path, compressed)?;
        Ok(())
    }

    pub fn read_snapshot(&self, hash: &CommitHash) -> Result<Graph, WillowError> {
        debug!(hash = %hash.0, "reading snapshot");
        let path = self.snapshots_dir().join(&hash.0);
        if !path.exists() {
            return Err(WillowError::VcsCommitNotFound(hash.0.clone()));
        }
        let compressed = std::fs::read(path)?;
        let mut decoder = zstd::Decoder::new(compressed.as_slice()).map_err(WillowError::Io)?;
        let mut json = Vec::new();
        decoder.read_to_end(&mut json).map_err(WillowError::Io)?;
        let graph: Graph = serde_json::from_slice(&json)?;
        Ok(graph)
    }

    // ---- Deltas ----

    pub fn write_delta(&self, hash: &CommitHash, delta: &Delta) -> Result<(), WillowError> {
        debug!(hash = %hash.0, "writing delta");
        self.write_json(&self.deltas_dir().join(&hash.0), delta)
    }

    pub fn read_delta(&self, hash: &CommitHash) -> Result<Delta, WillowError> {
        debug!(hash = %hash.0, "reading delta");
        self.read_json_or_not_found(&self.deltas_dir().join(&hash.0), hash)
    }

    /// Resolve HEAD to a concrete commit hash.
    pub fn resolve_head(&self) -> Result<Option<CommitHash>, WillowError> {
        let head = self.read_head()?;
        match head {
            HeadState::Branch(name) => self.read_branch_ref(&name),
            HeadState::Detached(hash) => Ok(Some(hash)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use crate::vcs::types::*;
    use chrono::Utc;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn test_repo() -> (TempDir, ObjectStore) {
        let dir = TempDir::new().unwrap();
        let repo_path = dir.path().join("repo");
        let store = ObjectStore::new(&repo_path);
        store.init().unwrap();
        (dir, store)
    }

    fn test_graph() -> Graph {
        let mut nodes = HashMap::new();
        let root_id = NodeId("root".to_string());
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
    fn test_config_round_trip() {
        let (_dir, store) = test_repo();
        let config = RepoConfig::default();
        store.write_config(&config).unwrap();
        let loaded = store.read_config().unwrap();
        assert_eq!(loaded.format_version, 1);
        assert_eq!(loaded.snapshot_interval, 50);
        assert_eq!(loaded.default_branch, "main");
    }

    #[test]
    fn test_head_branch_round_trip() {
        let (_dir, store) = test_repo();
        let state = HeadState::Branch("main".to_string());
        store.write_head(&state).unwrap();
        let loaded = store.read_head().unwrap();
        match loaded {
            HeadState::Branch(name) => assert_eq!(name, "main"),
            _ => panic!("Expected branch"),
        }
    }

    #[test]
    fn test_head_detached_round_trip() {
        let (_dir, store) = test_repo();
        let state = HeadState::Detached(CommitHash("abc123".to_string()));
        store.write_head(&state).unwrap();
        let loaded = store.read_head().unwrap();
        match loaded {
            HeadState::Detached(hash) => assert_eq!(hash.0, "abc123"),
            _ => panic!("Expected detached"),
        }
    }

    #[test]
    fn test_branch_ref_round_trip() {
        let (_dir, store) = test_repo();
        let hash = CommitHash("deadbeef".to_string());
        store.write_branch_ref("main", &hash).unwrap();
        let loaded = store.read_branch_ref("main").unwrap();
        assert_eq!(loaded.unwrap().0, "deadbeef");
    }

    #[test]
    fn test_list_branches() {
        let (_dir, store) = test_repo();
        let hash = CommitHash("abc".to_string());
        store.write_branch_ref("main", &hash).unwrap();
        store.write_branch_ref("experiment", &hash).unwrap();
        let branches = store.list_branches().unwrap();
        assert_eq!(branches, vec!["experiment", "main"]);
    }

    #[test]
    fn test_commit_round_trip() {
        let (_dir, store) = test_repo();
        let data = CommitData {
            parents: vec![],
            message: "Initial commit".to_string(),
            timestamp: Utc::now(),
            source: CommitSource::Migration,
            storage_type: CommitStorageType::Snapshot,
            depth_since_snapshot: 0,
        };
        let hash = ObjectStore::hash_commit(&data);
        store.write_commit(&hash, &data).unwrap();
        let loaded = store.read_commit(&hash).unwrap();
        assert_eq!(loaded.message, "Initial commit");
        assert_eq!(loaded.parents.len(), 0);
        // Verify source attribution survives round-trip
        match loaded.source {
            CommitSource::Migration => {}
            _ => panic!("Expected Migration source"),
        }
    }

    #[test]
    fn test_commit_source_conversation_round_trip() {
        let (_dir, store) = test_repo();
        let data = CommitData {
            parents: vec![],
            message: "Conversation commit".to_string(),
            timestamp: Utc::now(),
            source: CommitSource::Conversation {
                conversation_id: Some("conv-123".to_string()),
                summary: Some("Discussed hobbies".to_string()),
            },
            storage_type: CommitStorageType::Delta,
            depth_since_snapshot: 1,
        };
        let hash = ObjectStore::hash_commit(&data);
        store.write_commit(&hash, &data).unwrap();
        let loaded = store.read_commit(&hash).unwrap();
        match loaded.source {
            CommitSource::Conversation {
                conversation_id,
                summary,
            } => {
                assert_eq!(conversation_id.as_deref(), Some("conv-123"));
                assert_eq!(summary.as_deref(), Some("Discussed hobbies"));
            }
            _ => panic!("Expected Conversation source"),
        }
    }

    #[test]
    fn test_commit_source_maintenance_round_trip() {
        let (_dir, store) = test_repo();
        let data = CommitData {
            parents: vec![],
            message: "Maintenance commit".to_string(),
            timestamp: Utc::now(),
            source: CommitSource::Maintenance {
                job_id: Some("job-456".to_string()),
            },
            storage_type: CommitStorageType::Delta,
            depth_since_snapshot: 2,
        };
        let hash = ObjectStore::hash_commit(&data);
        store.write_commit(&hash, &data).unwrap();
        let loaded = store.read_commit(&hash).unwrap();
        match loaded.source {
            CommitSource::Maintenance { job_id } => {
                assert_eq!(job_id.as_deref(), Some("job-456"));
            }
            _ => panic!("Expected Maintenance source"),
        }
    }

    #[test]
    fn test_commit_source_merge_round_trip() {
        let (_dir, store) = test_repo();
        let data = CommitData {
            parents: vec![
                CommitHash("parent1".to_string()),
                CommitHash("parent2".to_string()),
            ],
            message: "Merge commit".to_string(),
            timestamp: Utc::now(),
            source: CommitSource::Merge {
                source_branch: "feature".to_string(),
                target_branch: "main".to_string(),
            },
            storage_type: CommitStorageType::Snapshot,
            depth_since_snapshot: 0,
        };
        let hash = ObjectStore::hash_commit(&data);
        store.write_commit(&hash, &data).unwrap();
        let loaded = store.read_commit(&hash).unwrap();
        match loaded.source {
            CommitSource::Merge {
                source_branch,
                target_branch,
            } => {
                assert_eq!(source_branch, "feature");
                assert_eq!(target_branch, "main");
            }
            _ => panic!("Expected Merge source"),
        }
        assert_eq!(loaded.parents.len(), 2);
    }

    #[test]
    fn test_snapshot_round_trip() {
        let (_dir, store) = test_repo();
        let graph = test_graph();
        let hash = CommitHash("snapshot1".to_string());
        store.write_snapshot(&hash, &graph).unwrap();
        let loaded = store.read_snapshot(&hash).unwrap();
        assert_eq!(loaded.root_id.0, "root");
        assert_eq!(loaded.nodes.len(), 1);
    }

    #[test]
    fn test_delta_round_trip() {
        let (_dir, store) = test_repo();
        let delta = Delta {
            changes: vec![Change::CreateNode {
                node_id: NodeId("new-node".to_string()),
                node: Node {
                    id: NodeId("new-node".to_string()),
                    node_type: NodeType::Detail,
                    content: "Test detail".to_string(),
                    parent_id: Some(NodeId("root".to_string())),
                    children: Vec::new(),
                    metadata: HashMap::new(),
                    previous_values: Vec::new(),
                    temporal: None,
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                },
            }],
        };
        let hash = CommitHash("delta1".to_string());
        store.write_delta(&hash, &delta).unwrap();
        let loaded = store.read_delta(&hash).unwrap();
        assert_eq!(loaded.changes.len(), 1);
    }

    #[test]
    fn test_commit_hash_deterministic() {
        let data = CommitData {
            parents: vec![],
            message: "test".to_string(),
            timestamp: chrono::DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            source: CommitSource::Migration,
            storage_type: CommitStorageType::Snapshot,
            depth_since_snapshot: 0,
        };
        let hash1 = ObjectStore::hash_commit(&data);
        let hash2 = ObjectStore::hash_commit(&data);
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.0.len(), 64); // SHA-256 hex
    }

    #[test]
    fn test_delete_branch_ref() {
        let (_dir, store) = test_repo();
        let hash = CommitHash("abc".to_string());
        store.write_branch_ref("temp", &hash).unwrap();
        assert!(store.read_branch_ref("temp").unwrap().is_some());
        store.delete_branch_ref("temp").unwrap();
        assert!(store.read_branch_ref("temp").unwrap().is_none());
    }

    #[test]
    fn test_resolve_head_branch() {
        let (_dir, store) = test_repo();
        let hash = CommitHash("commit1".to_string());
        store.write_head(&HeadState::Branch("main".to_string())).unwrap();
        store.write_branch_ref("main", &hash).unwrap();
        let resolved = store.resolve_head().unwrap();
        assert_eq!(resolved.unwrap().0, "commit1");
    }
}
