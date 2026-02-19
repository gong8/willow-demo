use crate::model::{Graph, Link, LinkId, Node, NodeId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CommitHash(pub String);

impl std::fmt::Display for CommitHash {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CommitSource {
    Conversation {
        conversation_id: Option<String>,
        summary: Option<String>,
    },
    Maintenance {
        job_id: Option<String>,
    },
    Manual {
        tool_name: Option<String>,
    },
    Merge {
        source_branch: String,
        target_branch: String,
    },
    Migration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommitStorageType {
    Snapshot,
    Delta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitData {
    pub parents: Vec<CommitHash>,
    pub message: String,
    pub timestamp: DateTime<Utc>,
    pub source: CommitSource,
    pub storage_type: CommitStorageType,
    pub depth_since_snapshot: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Change {
    CreateNode {
        node_id: NodeId,
        node: Node,
    },
    UpdateNode {
        node_id: NodeId,
        old_content: Option<String>,
        new_content: Option<String>,
        old_metadata: Option<HashMap<String, String>>,
        new_metadata: Option<HashMap<String, String>>,
    },
    DeleteNode {
        node_id: NodeId,
        deleted_nodes: Vec<Node>,
        deleted_links: Vec<Link>,
    },
    AddLink {
        link_id: LinkId,
        link: Link,
    },
    RemoveLink {
        link_id: LinkId,
        link: Link,
    },
    ReparentNode {
        node_id: NodeId,
        old_parent: Option<NodeId>,
        new_parent: Option<NodeId>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HeadState {
    Branch(String),
    Detached(CommitHash),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    pub format_version: u32,
    pub snapshot_interval: u32,
    pub default_branch: String,
}

impl Default for RepoConfig {
    fn default() -> Self {
        RepoConfig {
            format_version: 1,
            snapshot_interval: 50,
            default_branch: "main".to_string(),
        }
    }
}

/// Input for creating a commit.
#[derive(Debug, Clone)]
pub struct CommitInput {
    pub message: String,
    pub source: CommitSource,
}

/// A commit entry returned by log queries.
#[derive(Debug, Clone)]
pub struct CommitEntry {
    pub hash: CommitHash,
    pub data: CommitData,
}

/// Apply a delta's changes to a Graph in-place (forward replay).
pub fn apply_delta(graph: &mut Graph, delta: &Delta) {
    for change in &delta.changes {
        match change {
            Change::CreateNode { node_id, node } => {
                // Add to parent's children
                if let Some(ref parent_id) = node.parent_id {
                    if let Some(parent) = graph.nodes.get_mut(parent_id) {
                        if !parent.children.contains(node_id) {
                            parent.children.push(node_id.clone());
                        }
                    }
                }
                graph.nodes.insert(node_id.clone(), node.clone());
            }
            Change::UpdateNode {
                node_id,
                new_content,
                new_metadata,
                ..
            } => {
                if let Some(node) = graph.nodes.get_mut(node_id) {
                    if let Some(content) = new_content {
                        node.content = content.clone();
                    }
                    if let Some(metadata) = new_metadata {
                        node.metadata = metadata.clone();
                    }
                }
            }
            Change::DeleteNode {
                node_id,
                deleted_nodes,
                deleted_links,
                ..
            } => {
                // Remove from parent — clone parent_id to avoid borrow conflict
                let parent_id = graph
                    .nodes
                    .get(node_id)
                    .and_then(|n| n.parent_id.clone());
                if let Some(parent_id) = parent_id {
                    if let Some(parent) = graph.nodes.get_mut(&parent_id) {
                        parent.children.retain(|c| c != node_id);
                    }
                }
                // Remove all deleted nodes
                graph.nodes.remove(node_id);
                for dn in deleted_nodes {
                    graph.nodes.remove(&dn.id);
                }
                // Remove all deleted links
                for dl in deleted_links {
                    graph.links.remove(&dl.id);
                }
            }
            Change::AddLink { link_id, link } => {
                graph.links.insert(link_id.clone(), link.clone());
            }
            Change::RemoveLink { link_id, .. } => {
                graph.links.remove(link_id);
            }
            Change::ReparentNode {
                node_id,
                old_parent,
                new_parent,
            } => {
                // Remove from old parent
                if let Some(old_pid) = old_parent {
                    if let Some(parent) = graph.nodes.get_mut(old_pid) {
                        parent.children.retain(|c| c != node_id);
                    }
                }
                // Add to new parent
                if let Some(new_pid) = new_parent {
                    if let Some(parent) = graph.nodes.get_mut(new_pid) {
                        if !parent.children.contains(node_id) {
                            parent.children.push(node_id.clone());
                        }
                    }
                }
                // Update node's parent_id
                if let Some(node) = graph.nodes.get_mut(node_id) {
                    node.parent_id = new_parent.clone();
                }
            }
        }
    }
}
