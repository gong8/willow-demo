use crate::model::{Graph, Link, Node, NodeId};
use crate::vcs::types::CommitHash;
use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone)]
pub enum MergeSide {
    Ours,
    Theirs,
}

#[derive(Debug, Clone)]
pub enum ConflictType {
    ContentConflict {
        base: String,
        ours: String,
        theirs: String,
    },
    StructuralConflict {
        base_parent: NodeId,
        ours_parent: NodeId,
        theirs_parent: NodeId,
    },
    DeleteModifyConflict {
        deleted_by: MergeSide,
        modified_node: Node,
    },
    DeleteLinkConflict {
        deleted_node: NodeId,
        link: Link,
    },
}

#[derive(Debug, Clone)]
pub struct MergeConflict {
    pub node_id: NodeId,
    pub conflict_type: ConflictType,
}

#[derive(Debug, Clone)]
pub struct ConflictResolution {
    pub node_id: NodeId,
    pub resolved_content: Option<String>, // None = confirm delete
}

#[derive(Debug, Clone)]
pub enum MergeResult {
    Success(Graph),
    FastForward(CommitHash),
    Conflicts(Vec<MergeConflict>),
}

fn node_modified(node: &Node, base: &Node) -> bool {
    node.content != base.content || node.metadata != base.metadata
}

fn modify_parent(graph: &mut Graph, parent_id: &NodeId, child_id: &NodeId, add: bool) {
    if let Some(parent) = graph.nodes.get_mut(parent_id) {
        if add {
            if !parent.children.contains(child_id) {
                parent.children.push(child_id.clone());
            }
        } else {
            parent.children.retain(|c| c != child_id);
        }
    }
}

fn remove_node(graph: &mut Graph, node_id: &NodeId) {
    if let Some(pid) = graph.nodes.get(node_id).and_then(|n| n.parent_id.clone()) {
        modify_parent(graph, &pid, node_id, false);
    }
    graph.nodes.remove(node_id);
}

fn parent_id_or_empty(node: &Node) -> NodeId {
    node.parent_id
        .clone()
        .unwrap_or(NodeId("".to_string()))
}

fn bfs_expand(
    queue: &mut VecDeque<CommitHash>,
    visited: &mut HashSet<String>,
    other_visited: &HashSet<String>,
    read_parents: &dyn Fn(&CommitHash) -> Vec<CommitHash>,
) -> Option<CommitHash> {
    let hash = queue.pop_front()?;
    if other_visited.contains(&hash.0) {
        return Some(hash);
    }
    for parent in read_parents(&hash) {
        if visited.insert(parent.0.clone()) {
            queue.push_back(parent);
        }
    }
    None
}

/// Find the merge base (common ancestor) of two commits via BFS.
/// Returns None if no common ancestor exists (shouldn't happen with shared initial commit).
pub fn find_merge_base(
    ours: &CommitHash,
    theirs: &CommitHash,
    read_parents: &dyn Fn(&CommitHash) -> Vec<CommitHash>,
) -> Option<CommitHash> {
    if ours.0 == theirs.0 {
        return Some(ours.clone());
    }

    let mut ours_visited: HashSet<String> = HashSet::from([ours.0.clone()]);
    let mut theirs_visited: HashSet<String> = HashSet::from([theirs.0.clone()]);
    let mut ours_queue: VecDeque<CommitHash> = VecDeque::from([ours.clone()]);
    let mut theirs_queue: VecDeque<CommitHash> = VecDeque::from([theirs.clone()]);

    loop {
        if ours_queue.is_empty() && theirs_queue.is_empty() {
            return None;
        }

        if let Some(found) =
            bfs_expand(&mut ours_queue, &mut ours_visited, &theirs_visited, read_parents)
        {
            return Some(found);
        }
        if let Some(found) =
            bfs_expand(&mut theirs_queue, &mut theirs_visited, &ours_visited, read_parents)
        {
            return Some(found);
        }
    }
}

/// Check if `ancestor` is an ancestor of `descendant`.
pub fn is_ancestor(
    ancestor: &CommitHash,
    descendant: &CommitHash,
    read_parents: &dyn Fn(&CommitHash) -> Vec<CommitHash>,
) -> bool {
    if ancestor.0 == descendant.0 {
        return true;
    }
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<CommitHash> = VecDeque::new();
    queue.push_back(descendant.clone());
    visited.insert(descendant.0.clone());

    while let Some(hash) = queue.pop_front() {
        for parent in read_parents(&hash) {
            if parent.0 == ancestor.0 {
                return true;
            }
            if visited.insert(parent.0.clone()) {
                queue.push_back(parent);
            }
        }
    }
    false
}

fn merge_deleted_nodes(
    base: &Graph,
    deleter: &Graph,
    survivor: &Graph,
    deleted_by: MergeSide,
    merged: &mut Graph,
    conflicts: &mut Vec<MergeConflict>,
) {
    for (nid, base_node) in &base.nodes {
        if deleter.nodes.contains_key(nid) || !survivor.nodes.contains_key(nid) {
            continue;
        }
        let survivor_node = survivor.nodes.get(nid).unwrap();
        if node_modified(survivor_node, base_node) {
            conflicts.push(MergeConflict {
                node_id: nid.clone(),
                conflict_type: ConflictType::DeleteModifyConflict {
                    deleted_by: deleted_by.clone(),
                    modified_node: survivor_node.clone(),
                },
            });
        } else if matches!(deleted_by, MergeSide::Theirs) {
            remove_node(merged, nid);
        }
    }
}

fn reparent_node(merged: &mut Graph, nid: &NodeId, new_parent_id: &Option<NodeId>) {
    if let Some(old_pid) = merged.nodes.get(nid).and_then(|n| n.parent_id.clone()) {
        modify_parent(merged, &old_pid, nid, false);
    }
    if let Some(node) = merged.nodes.get_mut(nid) {
        node.parent_id = new_parent_id.clone();
    }
    if let Some(ref new_pid) = new_parent_id {
        modify_parent(merged, new_pid, nid, true);
    }
}

enum ThreeWayChange<T> {
    BothDiverged(T, T),
    OnlyTheirs(T),
    NoAction,
}

fn three_way_diff<T: PartialEq + Clone>(base: &T, ours: &T, theirs: &T) -> ThreeWayChange<T> {
    let ours_changed = ours != base;
    let theirs_changed = theirs != base;
    if ours_changed && theirs_changed && ours != theirs {
        ThreeWayChange::BothDiverged(ours.clone(), theirs.clone())
    } else if theirs_changed && !ours_changed {
        ThreeWayChange::OnlyTheirs(theirs.clone())
    } else {
        ThreeWayChange::NoAction
    }
}

/// Perform a three-way merge of two graphs given a common base.
pub fn three_way_merge(base: &Graph, ours: &Graph, theirs: &Graph) -> MergeResult {
    let mut merged = ours.clone();
    let mut conflicts = Vec::new();

    // 1. Nodes added only by theirs
    for (nid, node) in &theirs.nodes {
        if !base.nodes.contains_key(nid) && !ours.nodes.contains_key(nid) {
            if let Some(ref parent_id) = node.parent_id {
                modify_parent(&mut merged, parent_id, nid, true);
            }
            merged.nodes.insert(nid.clone(), node.clone());
        }
    }

    // 2. Nodes deleted by one side, possibly modified by the other
    merge_deleted_nodes(base, theirs, ours, MergeSide::Theirs, &mut merged, &mut conflicts);
    merge_deleted_nodes(base, ours, theirs, MergeSide::Ours, &mut merged, &mut conflicts);

    // 3. Nodes present in all three — check content and structural changes
    for (nid, base_node) in &base.nodes {
        let (Some(ours_node), Some(theirs_node)) =
            (ours.nodes.get(nid), theirs.nodes.get(nid))
        else {
            continue;
        };

        let content_key = |n: &Node| (n.content.clone(), n.metadata.clone());
        match three_way_diff(&content_key(base_node), &content_key(ours_node), &content_key(theirs_node)) {
            ThreeWayChange::BothDiverged(_, _) => {
                conflicts.push(MergeConflict {
                    node_id: nid.clone(),
                    conflict_type: ConflictType::ContentConflict {
                        base: base_node.content.clone(),
                        ours: ours_node.content.clone(),
                        theirs: theirs_node.content.clone(),
                    },
                });
            }
            ThreeWayChange::OnlyTheirs((content, metadata)) => {
                if let Some(node) = merged.nodes.get_mut(nid) {
                    node.content = content;
                    node.metadata = metadata;
                }
            }
            ThreeWayChange::NoAction => {}
        }

        match three_way_diff(&base_node.parent_id, &ours_node.parent_id, &theirs_node.parent_id) {
            ThreeWayChange::BothDiverged(_, _) => {
                conflicts.push(MergeConflict {
                    node_id: nid.clone(),
                    conflict_type: ConflictType::StructuralConflict {
                        base_parent: parent_id_or_empty(base_node),
                        ours_parent: parent_id_or_empty(ours_node),
                        theirs_parent: parent_id_or_empty(theirs_node),
                    },
                });
            }
            ThreeWayChange::OnlyTheirs(new_parent) => {
                reparent_node(&mut merged, nid, &new_parent);
            }
            ThreeWayChange::NoAction => {}
        }
    }

    // 4. Merge links from theirs
    for (lid, link) in &theirs.links {
        if !base.links.contains_key(lid)
            && !ours.links.contains_key(lid)
            && merged.nodes.contains_key(&link.from_node)
            && merged.nodes.contains_key(&link.to_node)
        {
            merged.links.insert(lid.clone(), link.clone());
        }
    }
    for lid in base.links.keys() {
        if !theirs.links.contains_key(lid) {
            merged.links.remove(lid);
        }
    }

    if conflicts.is_empty() {
        MergeResult::Success(merged)
    } else {
        MergeResult::Conflicts(conflicts)
    }
}

/// Apply conflict resolutions to a merged graph.
pub fn apply_resolutions(graph: &mut Graph, resolutions: &[ConflictResolution]) {
    for res in resolutions {
        if let Some(content) = &res.resolved_content {
            if let Some(node) = graph.nodes.get_mut(&res.node_id) {
                node.content = content.clone();
            }
        } else {
            remove_node(graph, &res.node_id);
            let node_id = &res.node_id;
            graph
                .links
                .retain(|_, link| link.from_node != *node_id && link.to_node != *node_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use chrono::Utc;
    use std::collections::HashMap;

    fn make_node(id: &str, content: &str, parent: Option<&str>, children: &[&str]) -> Node {
        let now = Utc::now();
        Node {
            id: NodeId(id.to_string()),
            node_type: if parent.is_none() { NodeType::Root } else { NodeType::Detail },
            content: content.to_string(),
            parent_id: parent.map(|p| NodeId(p.to_string())),
            children: children.iter().map(|c| NodeId(c.to_string())).collect(),
            metadata: HashMap::new(),
            previous_values: Vec::new(),
            temporal: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn add_node(graph: &mut Graph, node: Node) {
        let nid = node.id.clone();
        if let Some(ref pid) = node.parent_id {
            modify_parent(graph, pid, &nid, true);
        }
        graph.nodes.insert(nid, node);
    }

    fn base_graph() -> Graph {
        let mut nodes = HashMap::new();
        nodes.insert(NodeId("root".to_string()), make_node("root", "User", None, &["n1"]));
        nodes.insert(NodeId("n1".to_string()), make_node("n1", "Base content", Some("root"), &[]));
        Graph {
            root_id: NodeId("root".to_string()),
            nodes,
            links: HashMap::new(),
        }
    }

    fn ch(s: &str) -> CommitHash {
        CommitHash(s.to_string())
    }

    fn nid(s: &str) -> NodeId {
        NodeId(s.to_string())
    }

    #[test]
    fn test_find_merge_base_linear() {
        let (a, b, c) = (ch("a"), ch("b"), ch("c"));
        let parents = |h: &CommitHash| match h.0.as_str() {
            "c" => vec![b.clone()],
            "b" => vec![a.clone()],
            _ => vec![],
        };
        assert_eq!(find_merge_base(&b, &c, &parents).unwrap().0, "b");
    }

    #[test]
    fn test_find_merge_base_divergent() {
        let (a, b, c) = (ch("a"), ch("b"), ch("c"));
        let parents = |h: &CommitHash| match h.0.as_str() {
            "b" | "c" => vec![a.clone()],
            _ => vec![],
        };
        assert_eq!(find_merge_base(&b, &c, &parents).unwrap().0, "a");
    }

    #[test]
    fn test_merge_no_conflict_disjoint_adds() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        add_node(&mut ours, make_node("n2", "Ours added", Some("root"), &[]));
        add_node(&mut theirs, make_node("n3", "Theirs added", Some("root"), &[]));

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Success(merged) => {
                assert!(merged.nodes.contains_key(&nid("n2")));
                assert!(merged.nodes.contains_key(&nid("n3")));
                assert_eq!(merged.nodes.len(), 4);
            }
            other => panic!("Expected success, got {:?}", other),
        }
    }

    #[test]
    fn test_merge_content_conflict() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        ours.nodes.get_mut(&nid("n1")).unwrap().content = "Ours version".to_string();
        theirs.nodes.get_mut(&nid("n1")).unwrap().content = "Theirs version".to_string();

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Conflicts(conflicts) => {
                assert_eq!(conflicts.len(), 1);
                match &conflicts[0].conflict_type {
                    ConflictType::ContentConflict { base: b, ours: o, theirs: t } => {
                        assert_eq!(b, "Base content");
                        assert_eq!(o, "Ours version");
                        assert_eq!(t, "Theirs version");
                    }
                    _ => panic!("Expected ContentConflict"),
                }
            }
            other => panic!("Expected conflicts, got {:?}", other),
        }
    }

    #[test]
    fn test_merge_one_side_change() {
        let base = base_graph();
        let ours = base.clone();
        let mut theirs = base.clone();

        theirs.nodes.get_mut(&nid("n1")).unwrap().content = "Updated by theirs".to_string();

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Success(merged) => {
                assert_eq!(merged.nodes.get(&nid("n1")).unwrap().content, "Updated by theirs");
            }
            other => panic!("Expected success, got {:?}", other),
        }
    }

    #[test]
    fn test_merge_identical_changes() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        ours.nodes.get_mut(&nid("n1")).unwrap().content = "Same change".to_string();
        theirs.nodes.get_mut(&nid("n1")).unwrap().content = "Same change".to_string();

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Success(merged) => {
                assert_eq!(merged.nodes.get(&nid("n1")).unwrap().content, "Same change");
            }
            other => panic!("Expected success, got {:?}", other),
        }
    }

    #[test]
    fn test_merge_delete_modify_conflict() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        ours.nodes.get_mut(&nid("n1")).unwrap().content = "Modified".to_string();
        theirs.nodes.remove(&nid("n1"));
        theirs.nodes.get_mut(&nid("root")).unwrap().children.retain(|c| c != &nid("n1"));

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Conflicts(conflicts) => {
                assert_eq!(conflicts.len(), 1);
                assert!(matches!(&conflicts[0].conflict_type, ConflictType::DeleteModifyConflict { .. }));
            }
            other => panic!("Expected conflicts, got {:?}", other),
        }
    }

    #[test]
    fn test_is_ancestor() {
        let (a, b, c) = (ch("a"), ch("b"), ch("c"));
        let parents = |h: &CommitHash| match h.0.as_str() {
            "c" => vec![b.clone()],
            "b" => vec![a.clone()],
            _ => vec![],
        };

        assert!(is_ancestor(&a, &c, &parents));
        assert!(is_ancestor(&b, &c, &parents));
        assert!(is_ancestor(&a, &a, &parents));
        assert!(!is_ancestor(&c, &a, &parents));
    }
}
