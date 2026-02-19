use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LinkId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Root,
    Category,
    Detail,
}

impl NodeType {
    pub fn as_str(&self) -> &str {
        match self {
            NodeType::Root => "root",
            NodeType::Category => "category",
            NodeType::Detail => "detail",
        }
    }

    pub fn from_str(s: &str) -> Option<NodeType> {
        match s {
            "root" => Some(NodeType::Root),
            "category" => Some(NodeType::Category),
            "detail" => Some(NodeType::Detail),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalMetadata {
    pub valid_from: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupersededValue {
    pub old_content: String,
    pub superseded_at: DateTime<Utc>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub node_type: NodeType,
    pub content: String,
    pub parent_id: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub metadata: HashMap<String, String>,
    pub previous_values: Vec<SupersededValue>,
    pub temporal: Option<TemporalMetadata>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub id: LinkId,
    pub from_node: NodeId,
    pub to_node: NodeId,
    pub relation: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub root_id: NodeId,
    pub nodes: HashMap<NodeId, Node>,
    pub links: HashMap<LinkId, Link>,
}
