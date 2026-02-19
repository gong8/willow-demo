use thiserror::Error;

#[derive(Error, Debug)]
pub enum WillowError {
    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Link not found: {0}")]
    LinkNotFound(String),

    #[error("Cannot delete root node")]
    CannotDeleteRoot,

    #[error("Graph already has a root node")]
    DuplicateRoot,

    #[error("Parent node not found: {0}")]
    ParentNotFound(String),

    #[error("Invalid node type: {0}")]
    InvalidNodeType(String),

    #[error("Duplicate link from {from} to {to} with relation '{relation}'")]
    DuplicateLink {
        from: String,
        to: String,
        relation: String,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl From<WillowError> for napi::Error {
    fn from(e: WillowError) -> Self {
        napi::Error::from_reason(e.to_string())
    }
}
