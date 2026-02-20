use crate::model;
use crate::search;
use crate::store;
use crate::vcs;
use std::collections::HashMap;
use std::path::Path;
use tracing::{info, debug};

macro_rules! repo_op {
    ($self:expr, $op:expr) => {
        $op($self.repo()?).map_err(napi::Error::from)
    };
}

// ---- DTO structs ----

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
    pub source: String, // "conversation", "maintenance", "manual", "migration"
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

// ---- Conversions ----

fn node_to_js(node: &model::Node) -> JsNode {
    JsNode {
        id: node.id.0.clone(),
        node_type: node.node_type.as_str().to_string(),
        content: node.content.clone(),
        parent_id: node.parent_id.as_ref().map(|id| id.0.clone()),
        children: node.children.iter().map(|id| id.0.clone()).collect(),
        metadata: node.metadata.clone(),
        previous_values: node
            .previous_values
            .iter()
            .map(|sv| JsSupersededValue {
                old_content: sv.old_content.clone(),
                superseded_at: sv.superseded_at.to_rfc3339(),
                reason: sv.reason.clone(),
            })
            .collect(),
        temporal: node.temporal.as_ref().map(|t| JsTemporalMetadata {
            valid_from: t.valid_from.map(|d| d.to_rfc3339()),
            valid_until: t.valid_until.map(|d| d.to_rfc3339()),
            label: t.label.clone(),
        }),
        created_at: node.created_at.to_rfc3339(),
        updated_at: node.updated_at.to_rfc3339(),
    }
}

fn link_to_js(link: &model::Link) -> JsLink {
    JsLink {
        id: link.id.0.clone(),
        from_node: link.from_node.0.clone(),
        to_node: link.to_node.0.clone(),
        relation: link.relation.clone(),
        bidirectional: link.bidirectional,
        confidence: link.confidence.as_ref().map(|c| c.as_str().to_string()),
        created_at: link.created_at.to_rfc3339(),
    }
}

fn parse_rfc3339(s: &Option<String>) -> Option<chrono::DateTime<chrono::Utc>> {
    s.as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
}

fn js_temporal_to_model(t: &JsTemporalMetadata) -> model::TemporalMetadata {
    model::TemporalMetadata {
        valid_from: parse_rfc3339(&t.valid_from),
        valid_until: parse_rfc3339(&t.valid_until),
        label: t.label.clone(),
    }
}

fn search_result_to_js(r: &search::SearchResult) -> JsSearchResult {
    JsSearchResult {
        node_id: r.node_id.0.clone(),
        node_type: r.node_type.clone(),
        content: r.content.clone(),
        score: r.score,
        matched_field: r.matched_field.clone(),
        depth: r.depth as u32,
    }
}

fn commit_source_to_string(source: &vcs::types::CommitSource) -> (String, Option<String>) {
    match source {
        vcs::types::CommitSource::Conversation {
            conversation_id,
            summary,
        } => (
            "conversation".to_string(),
            conversation_id
                .clone()
                .or_else(|| summary.clone()),
        ),
        vcs::types::CommitSource::Maintenance { job_id } => {
            ("maintenance".to_string(), job_id.clone())
        }
        vcs::types::CommitSource::Manual { tool_name } => {
            ("manual".to_string(), tool_name.clone())
        }
        vcs::types::CommitSource::Merge {
            source_branch,
            target_branch,
        } => (
            "merge".to_string(),
            Some(format!("{} -> {}", source_branch, target_branch)),
        ),
        vcs::types::CommitSource::Migration => ("migration".to_string(), None),
    }
}

fn commit_entry_to_js(entry: &vcs::types::CommitEntry) -> JsCommitEntry {
    let (source, source_detail) = commit_source_to_string(&entry.data.source);
    JsCommitEntry {
        hash: entry.hash.0.clone(),
        message: entry.data.message.clone(),
        timestamp: entry.data.timestamp.to_rfc3339(),
        source,
        source_detail,
        parents: entry.data.parents.iter().map(|p| p.0.clone()).collect(),
        storage_type: match entry.data.storage_type {
            vcs::types::CommitStorageType::Snapshot => "snapshot".to_string(),
            vcs::types::CommitStorageType::Delta => "delta".to_string(),
        },
    }
}

fn node_change_to_js(n: &vcs::diff::NodeChangeSummary) -> JsNodeChangeSummary {
    JsNodeChangeSummary {
        node_id: n.node_id.clone(),
        node_type: n.node_type.clone(),
        content: n.content.clone(),
        old_content: n.old_content.clone(),
        path: n.path.clone(),
    }
}

fn link_change_to_js(l: &vcs::diff::LinkChangeSummary) -> JsLinkChangeSummary {
    JsLinkChangeSummary {
        link_id: l.link_id.clone(),
        from_node: l.from_node.clone(),
        to_node: l.to_node.clone(),
        relation: l.relation.clone(),
        bidirectional: l.bidirectional,
        confidence: l.confidence.clone(),
    }
}

fn diff_has_changes(diff: &vcs::diff::ChangeSummary) -> bool {
    !diff.nodes_created.is_empty()
        || !diff.nodes_updated.is_empty()
        || !diff.nodes_deleted.is_empty()
        || !diff.links_created.is_empty()
        || !diff.links_removed.is_empty()
        || !diff.links_updated.is_empty()
}

fn map_vec<T, U>(items: &[T], f: fn(&T) -> U) -> Vec<U> {
    items.iter().map(f).collect()
}

fn change_summary_to_js(diff: &vcs::diff::ChangeSummary) -> JsChangeSummary {
    JsChangeSummary {
        nodes_created: map_vec(&diff.nodes_created, node_change_to_js),
        nodes_updated: map_vec(&diff.nodes_updated, node_change_to_js),
        nodes_deleted: map_vec(&diff.nodes_deleted, node_change_to_js),
        links_created: map_vec(&diff.links_created, link_change_to_js),
        links_removed: map_vec(&diff.links_removed, link_change_to_js),
        links_updated: map_vec(&diff.links_updated, link_change_to_js),
    }
}

fn js_input_to_commit_input(input: JsCommitInput) -> vcs::types::CommitInput {
    let source = match input.source.as_str() {
        "conversation" => vcs::types::CommitSource::Conversation {
            conversation_id: input.conversation_id,
            summary: input.summary,
        },
        "maintenance" => vcs::types::CommitSource::Maintenance {
            job_id: input.job_id,
        },
        "migration" => vcs::types::CommitSource::Migration,
        _ => vcs::types::CommitSource::Manual {
            tool_name: input.tool_name,
        },
    };
    vcs::types::CommitInput {
        message: input.message,
        source,
    }
}

// ---- JsGraphStore ----

#[napi]
pub struct JsGraphStore {
    inner: store::GraphStore,
}

#[napi]
impl JsGraphStore {
    fn repo(&self) -> napi::Result<&vcs::repository::Repository> {
        self.inner.get_repo().map_err(napi::Error::from)
    }

    #[napi(factory)]
    pub fn open(file_path: String) -> napi::Result<Self> {
        crate::init_tracing();
        let inner =
            store::GraphStore::open(Path::new(&file_path)).map_err(napi::Error::from)?;
        info!("GraphStore opened");
        Ok(JsGraphStore { inner })
    }

    #[napi]
    pub fn search_nodes(
        &self,
        query: String,
        max_results: Option<u32>,
    ) -> Vec<JsSearchResult> {
        debug!(query = %query, "search_nodes");
        map_vec(
            &self.inner.search_nodes(&query, max_results.map(|n| n as usize)),
            search_result_to_js,
        )
    }

    #[napi]
    pub fn get_context(
        &self,
        node_id: String,
        depth: Option<u32>,
    ) -> napi::Result<JsContextResult> {
        debug!(node_id = %node_id, "get_context");
        let ctx = self.inner.get_context(&node_id, depth).map_err(napi::Error::from)?;
        Ok(JsContextResult {
            node: node_to_js(&ctx.node),
            ancestors: map_vec(&ctx.ancestors, node_to_js),
            descendants: map_vec(&ctx.descendants, node_to_js),
            links: map_vec(&ctx.links, link_to_js),
        })
    }

    #[napi]
    pub fn create_node(&mut self, input: JsCreateNodeInput) -> napi::Result<JsNode> {
        info!(node_type = %input.node_type, parent = %input.parent_id, "create_node");
        let temporal = input.temporal.as_ref().map(js_temporal_to_model);
        let node = self
            .inner
            .create_node(
                &input.parent_id,
                &input.node_type,
                &input.content,
                input.metadata,
                temporal,
            )
            .map_err(napi::Error::from)?;

        Ok(node_to_js(&node))
    }

    #[napi]
    pub fn update_node(&mut self, input: JsUpdateNodeInput) -> napi::Result<JsNode> {
        info!(node_id = %input.node_id, "update_node");
        let temporal = input.temporal.as_ref().map(js_temporal_to_model);
        let node = self
            .inner
            .update_node(
                &input.node_id,
                input.content.as_deref(),
                input.metadata,
                temporal,
                input.reason.as_deref(),
            )
            .map_err(napi::Error::from)?;

        Ok(node_to_js(&node))
    }

    #[napi]
    pub fn delete_node(&mut self, node_id: String) -> napi::Result<()> {
        info!(node_id = %node_id, "delete_node");
        self.inner.delete_node(&node_id).map_err(napi::Error::from)
    }

    #[napi]
    pub fn add_link(&mut self, input: JsAddLinkInput) -> napi::Result<JsLink> {
        info!(from = %input.from_node, to = %input.to_node, relation = %input.relation, "add_link");
        let link = self
            .inner
            .add_link(
                &input.from_node,
                &input.to_node,
                &input.relation,
                input.bidirectional.unwrap_or(false),
                input.confidence.as_deref(),
            )
            .map_err(napi::Error::from)?;

        Ok(link_to_js(&link))
    }

    #[napi]
    pub fn update_link(&mut self, input: JsUpdateLinkInput) -> napi::Result<JsLink> {
        info!(link_id = %input.link_id, "update_link");
        let link = self
            .inner
            .update_link(
                &input.link_id,
                input.relation.as_deref(),
                input.bidirectional,
                input.confidence.as_deref(),
            )
            .map_err(napi::Error::from)?;

        Ok(link_to_js(&link))
    }

    #[napi]
    pub fn delete_link(&mut self, link_id: String) -> napi::Result<JsLink> {
        info!(link_id = %link_id, "delete_link");
        let link = self
            .inner
            .delete_link(&link_id)
            .map_err(napi::Error::from)?;
        Ok(link_to_js(&link))
    }

    // ---- VCS methods ----

    #[napi]
    pub fn vcs_init(&mut self) -> napi::Result<()> {
        info!("vcs_init");
        self.inner.vcs_init().map_err(napi::Error::from)
    }

    #[napi]
    pub fn has_pending_changes(&self) -> bool {
        debug!("has_pending_changes");
        self.inner.has_pending_changes()
    }

    #[napi]
    pub fn commit(&mut self, input: JsCommitInput) -> napi::Result<String> {
        info!(message = %input.message, "commit");
        let hash = self.inner.commit(js_input_to_commit_input(input)).map_err(napi::Error::from)?;
        Ok(hash.0)
    }

    #[napi]
    pub fn commit_external_changes(&self, input: JsCommitInput) -> napi::Result<Option<String>> {
        let hash = self.inner
            .commit_external_changes(js_input_to_commit_input(input))
            .map_err(napi::Error::from)?;
        Ok(hash.map(|h| h.0))
    }

    #[napi]
    pub fn discard_changes(&mut self) -> napi::Result<()> {
        debug!("discard_changes");
        self.inner.discard_changes().map_err(napi::Error::from)
    }

    #[napi]
    pub fn log(&self, limit: Option<u32>) -> napi::Result<Vec<JsCommitEntry>> {
        debug!("log");
        let entries = repo_op!(self, |r: &vcs::repository::Repository| r.log(limit.map(|n| n as usize)))?;
        Ok(map_vec(&entries, commit_entry_to_js))
    }

    #[napi]
    pub fn show_commit(&self, hash: String) -> napi::Result<JsCommitDetail> {
        debug!(hash = %hash, "show_commit");
        let commit_hash = vcs::types::CommitHash(hash);
        let (data, diff) = repo_op!(self, |r: &vcs::repository::Repository| r.show_commit(&commit_hash))?;
        Ok(JsCommitDetail {
            commit: commit_entry_to_js(&vcs::types::CommitEntry { hash: commit_hash, data }),
            diff: change_summary_to_js(&diff),
        })
    }

    #[napi]
    pub fn diff(&self, from_hash: String, to_hash: String) -> napi::Result<JsChangeSummary> {
        debug!(from = %from_hash, to = %to_hash, "diff");
        let diff = repo_op!(self, |r: &vcs::repository::Repository| r.diff(
            &vcs::types::CommitHash(from_hash),
            &vcs::types::CommitHash(to_hash),
        ))?;
        Ok(change_summary_to_js(&diff))
    }

    #[napi]
    pub fn list_branches(&self) -> napi::Result<Vec<JsBranchInfo>> {
        debug!("list_branches");
        let branches = repo_op!(self, |r: &vcs::repository::Repository| r.list_branches())?;
        Ok(branches
            .iter()
            .map(|b| JsBranchInfo {
                name: b.name.clone(),
                head: b.head.0.clone(),
                is_current: b.is_current,
            })
            .collect())
    }

    #[napi]
    pub fn create_branch(&self, name: String) -> napi::Result<()> {
        debug!(name = %name, "create_branch");
        repo_op!(self, |r: &vcs::repository::Repository| r.create_branch(&name))
    }

    #[napi]
    pub fn switch_branch(&mut self, name: String) -> napi::Result<()> {
        info!(branch = %name, "switch_branch");
        self.inner.switch_branch(&name).map_err(napi::Error::from)
    }

    #[napi]
    pub fn delete_branch(&self, name: String) -> napi::Result<()> {
        debug!(name = %name, "delete_branch");
        repo_op!(self, |r: &vcs::repository::Repository| r.delete_branch(&name))
    }

    #[napi]
    pub fn current_branch(&self) -> napi::Result<Option<String>> {
        debug!("current_branch");
        repo_op!(self, |r: &vcs::repository::Repository| r.current_branch())
    }

    #[napi]
    pub fn merge_branch(&mut self, source: String) -> napi::Result<String> {
        info!(source = %source, "merge_branch");
        let hash = self
            .inner
            .merge_branch(&source)
            .map_err(napi::Error::from)?;
        Ok(hash.0)
    }

    #[napi]
    pub fn checkout_commit(&mut self, hash: String) -> napi::Result<()> {
        info!(hash = %hash, "checkout_commit");
        self.inner
            .checkout_commit(&vcs::types::CommitHash(hash))
            .map_err(napi::Error::from)
    }

    fn head_entry(&self) -> napi::Result<Option<vcs::types::CommitEntry>> {
        let entries = repo_op!(self, |r: &vcs::repository::Repository| r.log(Some(1)))?;
        Ok(entries.into_iter().next())
    }

    #[napi]
    pub fn head_hash(&self) -> napi::Result<Option<String>> {
        debug!("head_hash");
        Ok(self.head_entry()?.map(|e| e.hash.0))
    }

    #[napi]
    pub fn has_local_changes(&self) -> napi::Result<bool> {
        debug!("has_local_changes");
        let head = match self.head_entry()? {
            Some(e) => e.hash,
            None => return Ok(false),
        };
        let committed = repo_op!(self, |r: &vcs::repository::Repository| r.reconstruct_at(&head))?;
        Ok(diff_has_changes(&crate::vcs::diff::compute_graph_diff(&committed, &self.inner.graph)))
    }

    #[napi]
    pub fn graph_at_commit(&self, hash: String) -> napi::Result<String> {
        debug!(hash = %hash, "graph_at_commit");
        let graph = repo_op!(self, |r: &vcs::repository::Repository| r.reconstruct_at(&vcs::types::CommitHash(hash)))?;
        serde_json::to_string(&graph).map_err(|e| napi::Error::from_reason(e.to_string()))
    }

    #[napi]
    pub fn restore_to_commit(&mut self, hash: String) -> napi::Result<String> {
        info!(hash = %hash, "restore_to_commit");
        let new_hash = self
            .inner
            .restore_to_commit(&vcs::types::CommitHash(hash))
            .map_err(napi::Error::from)?;
        Ok(new_hash.0)
    }

    #[napi]
    pub fn diff_disk_vs_head(&self) -> napi::Result<JsChangeSummary> {
        debug!("diff_disk_vs_head");
        let head = match self.head_entry()? {
            Some(e) => e.hash,
            None => return Ok(JsChangeSummary::default()),
        };
        let committed = repo_op!(self, |r: &vcs::repository::Repository| r.reconstruct_at(&head))?;
        let disk = crate::storage::load_graph(&self.inner.path).map_err(napi::Error::from)?;
        Ok(change_summary_to_js(&crate::vcs::diff::compute_graph_diff(&committed, &disk)))
    }
}
