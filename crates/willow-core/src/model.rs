use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LinkId(pub String);

/// Generate `as_str()` and `from_str()` for a snake_case enum.
macro_rules! str_enum {
    ($T:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        impl $T {
            pub fn as_str(&self) -> &str {
                match self { $( $T::$variant => $s, )+ }
            }
            pub fn from_str(s: &str) -> Option<$T> {
                match s { $( $s => Some($T::$variant), )+ _ => None }
            }
        }
        impl std::fmt::Display for $T {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Root,
    Category,
    Collection,
    Entity,
    Attribute,
    Event,
    Detail,
}

str_enum!(NodeType {
    Root => "root",
    Category => "category",
    Collection => "collection",
    Entity => "entity",
    Attribute => "attribute",
    Event => "event",
    Detail => "detail",
});

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceLevel {
    Low,
    Medium,
    High,
}

str_enum!(ConfidenceLevel {
    Low => "low",
    Medium => "medium",
    High => "high",
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub id: LinkId,
    pub from_node: NodeId,
    pub to_node: NodeId,
    pub relation: String,
    #[serde(default)]
    pub bidirectional: bool,
    pub confidence: Option<ConfidenceLevel>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub root_id: NodeId,
    pub nodes: HashMap<NodeId, Node>,
    pub links: HashMap<LinkId, Link>,
}

impl Graph {
    pub fn empty(root_id: NodeId) -> Self {
        Graph {
            root_id,
            nodes: HashMap::new(),
            links: HashMap::new(),
        }
    }
}
