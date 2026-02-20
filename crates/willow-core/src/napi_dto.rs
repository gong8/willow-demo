use std::collections::HashMap;

// ---- Graph DTO structs ----

#[napi(object)]
pub struct JsTemporalMetadata {
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
    pub label: Option<String>,
}

#[napi(object)]
pub struct JsSupersededValue {
    pub old_content: String,
    pub superseded_at: String,
    pub reason: Option<String>,
}

#[napi(object)]
pub struct JsNode {
    pub id: String,
    pub node_type: String,
    pub content: String,
    pub parent_id: Option<String>,
    pub children: Vec<String>,
    pub metadata: HashMap<String, String>,
    pub previous_values: Vec<JsSupersededValue>,
    pub temporal: Option<JsTemporalMetadata>,
    pub created_at: String,
    pub updated_at: String,
}

#[napi(object)]
pub struct JsLink {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub relation: String,
    pub bidirectional: bool,
    pub confidence: Option<String>,
    pub created_at: String,
}

#[napi(object)]
pub struct JsSearchResult {
    pub node_id: String,
    pub node_type: String,
    pub content: String,
    pub score: f64,
    pub matched_field: String,
    pub depth: u32,
}

#[napi(object)]
pub struct JsContextResult {
    pub node: JsNode,
    pub ancestors: Vec<JsNode>,
    pub descendants: Vec<JsNode>,
    pub links: Vec<JsLink>,
}

// ---- Graph input structs ----

#[napi(object)]
pub struct JsCreateNodeInput {
    pub parent_id: String,
    pub node_type: String,
    pub content: String,
    pub metadata: Option<HashMap<String, String>>,
    pub temporal: Option<JsTemporalMetadata>,
}

#[napi(object)]
pub struct JsUpdateNodeInput {
    pub node_id: String,
    pub content: Option<String>,
    pub metadata: Option<HashMap<String, String>>,
    pub temporal: Option<JsTemporalMetadata>,
    pub reason: Option<String>,
}

#[napi(object)]
pub struct JsAddLinkInput {
    pub from_node: String,
    pub to_node: String,
    pub relation: String,
    pub bidirectional: Option<bool>,
    pub confidence: Option<String>,
}

#[napi(object)]
pub struct JsUpdateLinkInput {
    pub link_id: String,
    pub relation: Option<String>,
    pub bidirectional: Option<bool>,
    pub confidence: Option<String>,
}

// ---- VCS DTO structs ----

#[napi(object)]
pub struct JsCommitInput {
    pub message: String,
    pub source: String,
    pub conversation_id: Option<String>,
    pub summary: Option<String>,
    pub job_id: Option<String>,
    pub tool_name: Option<String>,
}

#[napi(object)]
pub struct JsCommitEntry {
    pub hash: String,
    pub message: String,
    pub timestamp: String,
    pub source: String,
    pub source_detail: Option<String>,
    pub parents: Vec<String>,
    pub storage_type: String,
}

#[napi(object)]
pub struct JsNodeChangeSummary {
    pub node_id: String,
    pub node_type: String,
    pub content: String,
    pub old_content: Option<String>,
    pub path: Vec<String>,
}

#[napi(object)]
pub struct JsLinkChangeSummary {
    pub link_id: String,
    pub from_node: String,
    pub to_node: String,
    pub relation: String,
    pub bidirectional: bool,
    pub confidence: Option<String>,
}

#[napi(object)]
#[derive(Default)]
pub struct JsChangeSummary {
    pub nodes_created: Vec<JsNodeChangeSummary>,
    pub nodes_updated: Vec<JsNodeChangeSummary>,
    pub nodes_deleted: Vec<JsNodeChangeSummary>,
    pub links_created: Vec<JsLinkChangeSummary>,
    pub links_removed: Vec<JsLinkChangeSummary>,
    pub links_updated: Vec<JsLinkChangeSummary>,
}

#[napi(object)]
pub struct JsCommitDetail {
    pub commit: JsCommitEntry,
    pub diff: JsChangeSummary,
}

#[napi(object)]
pub struct JsBranchInfo {
    pub name: String,
    pub head: String,
    pub is_current: bool,
}
