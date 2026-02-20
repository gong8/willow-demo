use crate::napi_convert::{convert_vec, diff_has_changes, js_temporal_to_model};
use crate::napi_dto::*;
use crate::store;
use crate::vcs;
use std::path::Path;
use tracing::{debug, info};

macro_rules! repo_op {
    ($self:expr, |$r:ident| $body:expr) => {{
        let $r = $self.repo()?;
        ($body).map_err(napi::Error::from)
    }};
}

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

    // ---- Graph operations ----

    #[napi]
    pub fn search_nodes(
        &self,
        query: String,
        max_results: Option<u32>,
    ) -> Vec<JsSearchResult> {
        debug!(query = %query, "search_nodes");
        convert_vec(&self.inner.search_nodes(&query, max_results.map(|n| n as usize)))
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
            node: (&ctx.node).into(),
            ancestors: convert_vec(&ctx.ancestors),
            descendants: convert_vec(&ctx.descendants),
            links: convert_vec(&ctx.links),
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
        Ok((&node).into())
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
        Ok((&node).into())
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
        Ok((&link).into())
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
        Ok((&link).into())
    }

    #[napi]
    pub fn delete_link(&mut self, link_id: String) -> napi::Result<JsLink> {
        info!(link_id = %link_id, "delete_link");
        let link = self
            .inner
            .delete_link(&link_id)
            .map_err(napi::Error::from)?;
        Ok((&link).into())
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
        let hash = self.inner.commit(input.into()).map_err(napi::Error::from)?;
        Ok(hash.0)
    }

    #[napi]
    pub fn commit_external_changes(&self, input: JsCommitInput) -> napi::Result<Option<String>> {
        let hash = self.inner
            .commit_external_changes(input.into())
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
        let entries = repo_op!(self, |r| r.log(limit.map(|n| n as usize)))?;
        Ok(convert_vec(&entries))
    }

    #[napi]
    pub fn show_commit(&self, hash: String) -> napi::Result<JsCommitDetail> {
        debug!(hash = %hash, "show_commit");
        let commit_hash = vcs::types::CommitHash(hash);
        let (data, diff) = repo_op!(self, |r| r.show_commit(&commit_hash))?;
        Ok(JsCommitDetail {
            commit: (&vcs::types::CommitEntry { hash: commit_hash, data }).into(),
            diff: (&diff).into(),
        })
    }

    #[napi]
    pub fn diff(&self, from_hash: String, to_hash: String) -> napi::Result<JsChangeSummary> {
        debug!(from = %from_hash, to = %to_hash, "diff");
        let diff = repo_op!(self, |r| r.diff(
            &vcs::types::CommitHash(from_hash),
            &vcs::types::CommitHash(to_hash),
        ))?;
        Ok((&diff).into())
    }

    #[napi]
    pub fn list_branches(&self) -> napi::Result<Vec<JsBranchInfo>> {
        debug!("list_branches");
        let branches = repo_op!(self, |r| r.list_branches())?;
        Ok(convert_vec(&branches))
    }

    #[napi]
    pub fn create_branch(&self, name: String) -> napi::Result<()> {
        debug!(name = %name, "create_branch");
        repo_op!(self, |r| r.create_branch(&name))
    }

    #[napi]
    pub fn switch_branch(&mut self, name: String) -> napi::Result<()> {
        info!(branch = %name, "switch_branch");
        self.inner.switch_branch(&name).map_err(napi::Error::from)
    }

    #[napi]
    pub fn delete_branch(&self, name: String) -> napi::Result<()> {
        debug!(name = %name, "delete_branch");
        repo_op!(self, |r| r.delete_branch(&name))
    }

    #[napi]
    pub fn current_branch(&self) -> napi::Result<Option<String>> {
        debug!("current_branch");
        repo_op!(self, |r| r.current_branch())
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
        let entries = repo_op!(self, |r| r.log(Some(1)))?;
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
        let committed = repo_op!(self, |r| r.reconstruct_at(&head))?;
        Ok(diff_has_changes(&crate::vcs::diff::compute_graph_diff(&committed, &self.inner.graph)))
    }

    #[napi]
    pub fn graph_at_commit(&self, hash: String) -> napi::Result<String> {
        debug!(hash = %hash, "graph_at_commit");
        let graph = repo_op!(self, |r| r.reconstruct_at(&vcs::types::CommitHash(hash)))?;
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
        let committed = repo_op!(self, |r| r.reconstruct_at(&head))?;
        let disk = crate::storage::load_graph(&self.inner.path).map_err(napi::Error::from)?;
        Ok((&crate::vcs::diff::compute_graph_diff(&committed, &disk)).into())
    }
}
