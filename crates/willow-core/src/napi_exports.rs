use crate::model;
use crate::search;
use crate::store;
use std::collections::HashMap;
use std::path::Path;

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
        created_at: link.created_at.to_rfc3339(),
    }
}

fn js_temporal_to_model(t: &JsTemporalMetadata) -> model::TemporalMetadata {
    model::TemporalMetadata {
        valid_from: t
            .valid_from
            .as_ref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        valid_until: t
            .valid_until
            .as_ref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
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

// ---- JsGraphStore ----

#[napi]
pub struct JsGraphStore {
    inner: store::GraphStore,
}

#[napi]
impl JsGraphStore {
    #[napi(factory)]
    pub fn open(file_path: String) -> napi::Result<Self> {
        let inner =
            store::GraphStore::open(Path::new(&file_path)).map_err(napi::Error::from)?;
        Ok(JsGraphStore { inner })
    }

    #[napi]
    pub fn search_nodes(
        &self,
        query: String,
        max_results: Option<u32>,
    ) -> Vec<JsSearchResult> {
        self.inner
            .search_nodes(&query, max_results.map(|n| n as usize))
            .iter()
            .map(search_result_to_js)
            .collect()
    }

    #[napi]
    pub fn get_context(
        &self,
        node_id: String,
        depth: Option<u32>,
    ) -> napi::Result<JsContextResult> {
        let ctx = self
            .inner
            .get_context(&node_id, depth)
            .map_err(napi::Error::from)?;

        Ok(JsContextResult {
            node: node_to_js(&ctx.node),
            ancestors: ctx.ancestors.iter().map(node_to_js).collect(),
            descendants: ctx.descendants.iter().map(node_to_js).collect(),
            links: ctx.links.iter().map(link_to_js).collect(),
        })
    }

    #[napi]
    pub fn create_node(&mut self, input: JsCreateNodeInput) -> napi::Result<JsNode> {
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
        self.inner
            .delete_node(&node_id)
            .map_err(napi::Error::from)?;
        Ok(())
    }

    #[napi]
    pub fn add_link(&mut self, input: JsAddLinkInput) -> napi::Result<JsLink> {
        let link = self
            .inner
            .add_link(&input.from_node, &input.to_node, &input.relation)
            .map_err(napi::Error::from)?;

        Ok(link_to_js(&link))
    }
}
