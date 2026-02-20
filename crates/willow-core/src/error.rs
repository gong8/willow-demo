use thiserror::Error;

#[derive(Error, Debug)]
pub enum WillowError {
    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Link not found: {0}")]
    LinkNotFound(String),

    #[error("Cannot delete root node")]
    CannotDeleteRoot,

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

    #[error("Invalid confidence level: {0}")]
    InvalidConfidence(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    // VCS errors
    #[error("VCS not initialized — call vcs_init() first")]
    VcsNotInitialized,

    #[error("Branch not found: {0}")]
    BranchNotFound(String),

    #[error("Branch already exists: {0}")]
    BranchAlreadyExists(String),

    #[error("Cannot delete current branch: {0}")]
    CannotDeleteCurrentBranch(String),

    #[error("Cannot delete default branch: {0}")]
    CannotDeleteDefaultBranch(String),

    #[error("Nothing to commit — no pending changes")]
    NothingToCommit,

    #[error("Commit not found: {0}")]
    VcsCommitNotFound(String),

    #[error("Has pending changes — commit or discard before switching branches")]
    HasPendingChanges,

    #[error("Merge conflict: {0} conflicts found")]
    MergeConflict(usize),

    #[error("VCS already initialized")]
    VcsAlreadyInitialized,
}

impl From<WillowError> for napi::Error {
    fn from(e: WillowError) -> Self {
        napi::Error::from_reason(e.to_string())
    }
}
