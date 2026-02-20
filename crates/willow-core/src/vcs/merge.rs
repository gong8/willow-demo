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

fn remove_child(graph: &mut Graph, parent_id: &NodeId, child_id: &NodeId) {
    if let Some(parent) = graph.nodes.get_mut(parent_id) {
        parent.children.retain(|c| c != child_id);
    }
}

fn add_child(graph: &mut Graph, parent_id: &NodeId, child_id: &NodeId) {
    if let Some(parent) = graph.nodes.get_mut(parent_id) {
        if !parent.children.contains(child_id) {
            parent.children.push(child_id.clone());
        }
    }
}

fn remove_node(graph: &mut Graph, node_id: &NodeId) {
    let parent_id = graph.nodes.get(node_id).and_then(|n| n.parent_id.clone());
    if let Some(ref pid) = parent_id {
        remove_child(graph, pid, node_id);
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
    if let Some(hash) = queue.pop_front() {
        if other_visited.contains(&hash.0) {
            return Some(hash);
        }
        for parent in read_parents(&hash) {
            if visited.insert(parent.0.clone()) {
                queue.push_back(parent);
            }
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
    let old_parent_id = merged.nodes.get(nid).and_then(|n| n.parent_id.clone());
    if let Some(ref old_pid) = old_parent_id {
        remove_child(merged, old_pid, nid);
    }
    if let Some(node) = merged.nodes.get_mut(nid) {
        node.parent_id = new_parent_id.clone();
    }
    if let Some(ref new_pid) = new_parent_id {
        add_child(merged, new_pid, nid);
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
                add_child(&mut merged, parent_id, nid);
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

        let ours_changed = node_modified(ours_node, base_node);
        let theirs_changed = node_modified(theirs_node, base_node);

        if ours_changed && theirs_changed
            && (ours_node.content != theirs_node.content
                || ours_node.metadata != theirs_node.metadata)
        {
            conflicts.push(MergeConflict {
                node_id: nid.clone(),
                conflict_type: ConflictType::ContentConflict {
                    base: base_node.content.clone(),
                    ours: ours_node.content.clone(),
                    theirs: theirs_node.content.clone(),
                },
            });
        } else if theirs_changed && !ours_changed {
            if let Some(node) = merged.nodes.get_mut(nid) {
                node.content = theirs_node.content.clone();
                node.metadata = theirs_node.metadata.clone();
            }
        }

        let ours_parent_changed = ours_node.parent_id != base_node.parent_id;
        let theirs_parent_changed = theirs_node.parent_id != base_node.parent_id;

        if ours_parent_changed && theirs_parent_changed
            && ours_node.parent_id != theirs_node.parent_id
        {
            conflicts.push(MergeConflict {
                node_id: nid.clone(),
                conflict_type: ConflictType::StructuralConflict {
                    base_parent: parent_id_or_empty(base_node),
                    ours_parent: parent_id_or_empty(ours_node),
                    theirs_parent: parent_id_or_empty(theirs_node),
                },
            });
        } else if theirs_parent_changed && !ours_parent_changed {
            reparent_node(&mut merged, nid, &theirs_node.parent_id);
        }
    }

    // 4. Links added by theirs
    for (lid, link) in &theirs.links {
        if !base.links.contains_key(lid)
            && !ours.links.contains_key(lid)
            && merged.nodes.contains_key(&link.from_node)
            && merged.nodes.contains_key(&link.to_node)
        {
            merged.links.insert(lid.clone(), link.clone());
        }
    }

    // Links removed by theirs
    for lid in base.links.keys() {
        if !theirs.links.contains_key(lid) && ours.links.contains_key(lid) {
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

    fn base_graph() -> Graph {
        let root_id = NodeId("root".to_string());
        let n1_id = NodeId("n1".to_string());
        let mut nodes = HashMap::new();
        let now = Utc::now();

        nodes.insert(
            root_id.clone(),
            Node {
                id: root_id.clone(),
                node_type: NodeType::Root,
                content: "User".to_string(),
                parent_id: None,
                children: vec![n1_id.clone()],
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: now,
                updated_at: now,
            },
        );
        nodes.insert(
            n1_id.clone(),
            Node {
                id: n1_id.clone(),
                node_type: NodeType::Detail,
                content: "Base content".to_string(),
                parent_id: Some(root_id.clone()),
                children: Vec::new(),
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: now,
                updated_at: now,
            },
        );

        Graph {
            root_id,
            nodes,
            links: HashMap::new(),
        }
    }

    #[test]
    fn test_find_merge_base_linear() {
        // a <- b <- c
        let a = CommitHash("a".to_string());
        let b = CommitHash("b".to_string());
        let c = CommitHash("c".to_string());

        let parents = |h: &CommitHash| -> Vec<CommitHash> {
            match h.0.as_str() {
                "c" => vec![b.clone()],
                "b" => vec![a.clone()],
                "a" => vec![],
                _ => vec![],
            }
        };

        let base = find_merge_base(&b, &c, &parents);
        assert_eq!(base.unwrap().0, "b");
    }

    #[test]
    fn test_find_merge_base_divergent() {
        // a <- b (ours), a <- c (theirs)
        let a = CommitHash("a".to_string());
        let b = CommitHash("b".to_string());
        let c = CommitHash("c".to_string());

        let parents = |h: &CommitHash| -> Vec<CommitHash> {
            match h.0.as_str() {
                "b" => vec![a.clone()],
                "c" => vec![a.clone()],
                "a" => vec![],
                _ => vec![],
            }
        };

        let base = find_merge_base(&b, &c, &parents);
        assert_eq!(base.unwrap().0, "a");
    }

    #[test]
    fn test_merge_no_conflict_disjoint_adds() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        // Ours adds n2
        let n2 = NodeId("n2".to_string());
        ours.nodes.insert(
            n2.clone(),
            Node {
                id: n2.clone(),
                node_type: NodeType::Detail,
                content: "Ours added".to_string(),
                parent_id: Some(NodeId("root".to_string())),
                children: Vec::new(),
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        );
        ours.nodes
            .get_mut(&NodeId("root".to_string()))
            .unwrap()
            .children
            .push(n2);

        // Theirs adds n3
        let n3 = NodeId("n3".to_string());
        theirs.nodes.insert(
            n3.clone(),
            Node {
                id: n3.clone(),
                node_type: NodeType::Detail,
                content: "Theirs added".to_string(),
                parent_id: Some(NodeId("root".to_string())),
                children: Vec::new(),
                metadata: HashMap::new(),
                previous_values: Vec::new(),
                temporal: None,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
        );
        theirs
            .nodes
            .get_mut(&NodeId("root".to_string()))
            .unwrap()
            .children
            .push(n3);

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Success(merged) => {
                assert!(merged.nodes.contains_key(&NodeId("n2".to_string())));
                assert!(merged.nodes.contains_key(&NodeId("n3".to_string())));
                assert_eq!(merged.nodes.len(), 4); // root, n1, n2, n3
            }
            other => panic!("Expected success, got {:?}", other),
        }
    }

    #[test]
    fn test_merge_content_conflict() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        let n1 = NodeId("n1".to_string());
        ours.nodes.get_mut(&n1).unwrap().content = "Ours version".to_string();
        theirs.nodes.get_mut(&n1).unwrap().content = "Theirs version".to_string();

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Conflicts(conflicts) => {
                assert_eq!(conflicts.len(), 1);
                match &conflicts[0].conflict_type {
                    ConflictType::ContentConflict {
                        base: b,
                        ours: o,
                        theirs: t,
                    } => {
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

        let n1 = NodeId("n1".to_string());
        theirs.nodes.get_mut(&n1).unwrap().content = "Updated by theirs".to_string();

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Success(merged) => {
                assert_eq!(
                    merged.nodes.get(&n1).unwrap().content,
                    "Updated by theirs"
                );
            }
            other => panic!("Expected success, got {:?}", other),
        }
    }

    #[test]
    fn test_merge_identical_changes() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        let n1 = NodeId("n1".to_string());
        ours.nodes.get_mut(&n1).unwrap().content = "Same change".to_string();
        theirs.nodes.get_mut(&n1).unwrap().content = "Same change".to_string();

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Success(merged) => {
                assert_eq!(merged.nodes.get(&n1).unwrap().content, "Same change");
            }
            other => panic!("Expected success, got {:?}", other),
        }
    }

    #[test]
    fn test_merge_delete_modify_conflict() {
        let base = base_graph();
        let mut ours = base.clone();
        let mut theirs = base.clone();

        let n1 = NodeId("n1".to_string());
        // Ours modifies
        ours.nodes.get_mut(&n1).unwrap().content = "Modified".to_string();
        // Theirs deletes
        theirs.nodes.remove(&n1);
        theirs
            .nodes
            .get_mut(&NodeId("root".to_string()))
            .unwrap()
            .children
            .retain(|c| c != &n1);

        match three_way_merge(&base, &ours, &theirs) {
            MergeResult::Conflicts(conflicts) => {
                assert_eq!(conflicts.len(), 1);
                matches!(&conflicts[0].conflict_type, ConflictType::DeleteModifyConflict { .. });
            }
            other => panic!("Expected conflicts, got {:?}", other),
        }
    }

    #[test]
    fn test_is_ancestor() {
        let a = CommitHash("a".to_string());
        let b = CommitHash("b".to_string());
        let c = CommitHash("c".to_string());

        let parents = |h: &CommitHash| -> Vec<CommitHash> {
            match h.0.as_str() {
                "c" => vec![b.clone()],
                "b" => vec![a.clone()],
                _ => vec![],
            }
        };

        assert!(is_ancestor(&a, &c, &parents));
        assert!(is_ancestor(&b, &c, &parents));
        assert!(is_ancestor(&a, &a, &parents));
        assert!(!is_ancestor(&c, &a, &parents));
    }
}
