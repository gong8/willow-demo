use crate::model::{Graph, Link, LinkId, Node, NodeId};
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

/// Find the merge base (common ancestor) of two commits via BFS.
/// Returns None if no common ancestor exists (shouldn't happen with shared initial commit).
pub fn find_merge_base(
    ours: &CommitHash,
    theirs: &CommitHash,
    read_parents: &dyn Fn(&CommitHash) -> Vec<CommitHash>,
) -> Option<CommitHash> {
    // BFS from both sides, find first intersection
    let mut ours_visited: HashSet<String> = HashSet::new();
    let mut theirs_visited: HashSet<String> = HashSet::new();
    let mut ours_queue: VecDeque<CommitHash> = VecDeque::new();
    let mut theirs_queue: VecDeque<CommitHash> = VecDeque::new();

    ours_queue.push_back(ours.clone());
    theirs_queue.push_back(theirs.clone());
    ours_visited.insert(ours.0.clone());
    theirs_visited.insert(theirs.0.clone());

    // Check if they're the same commit
    if ours.0 == theirs.0 {
        return Some(ours.clone());
    }

    loop {
        let ours_done = ours_queue.is_empty();
        let theirs_done = theirs_queue.is_empty();

        if ours_done && theirs_done {
            return None;
        }

        // Expand ours
        if let Some(hash) = ours_queue.pop_front() {
            if theirs_visited.contains(&hash.0) {
                return Some(hash);
            }
            for parent in read_parents(&hash) {
                if ours_visited.insert(parent.0.clone()) {
                    ours_queue.push_back(parent);
                }
            }
        }

        // Expand theirs
        if let Some(hash) = theirs_queue.pop_front() {
            if ours_visited.contains(&hash.0) {
                return Some(hash);
            }
            for parent in read_parents(&hash) {
                if theirs_visited.insert(parent.0.clone()) {
                    theirs_queue.push_back(parent);
                }
            }
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

/// Perform a three-way merge of two graphs given a common base.
pub fn three_way_merge(base: &Graph, ours: &Graph, theirs: &Graph) -> MergeResult {
    let mut merged = ours.clone();
    let mut conflicts = Vec::new();

    // Collect IDs
    let base_node_ids: HashSet<&NodeId> = base.nodes.keys().collect();
    let ours_node_ids: HashSet<&NodeId> = ours.nodes.keys().collect();
    let theirs_node_ids: HashSet<&NodeId> = theirs.nodes.keys().collect();

    // 1. Nodes added only by theirs → add to merged
    for nid in &theirs_node_ids {
        if !base_node_ids.contains(nid) && !ours_node_ids.contains(nid) {
            let node = theirs.nodes.get(*nid).unwrap().clone();
            // Also add to parent's children
            if let Some(ref parent_id) = node.parent_id {
                if let Some(parent) = merged.nodes.get_mut(parent_id) {
                    if !parent.children.contains(nid) {
                        parent.children.push((*nid).clone());
                    }
                }
            }
            merged.nodes.insert((*nid).clone(), node);
        }
    }

    // 2. Nodes deleted by theirs (in base but not in theirs)
    for nid in &base_node_ids {
        if !theirs_node_ids.contains(nid) {
            if ours_node_ids.contains(nid) {
                let ours_node = ours.nodes.get(*nid).unwrap();
                let base_node = base.nodes.get(*nid).unwrap();
                // If ours also modified it → conflict
                if ours_node.content != base_node.content
                    || ours_node.metadata != base_node.metadata
                {
                    conflicts.push(MergeConflict {
                        node_id: (*nid).clone(),
                        conflict_type: ConflictType::DeleteModifyConflict {
                            deleted_by: MergeSide::Theirs,
                            modified_node: ours_node.clone(),
                        },
                    });
                } else {
                    // Ours didn't modify, accept theirs' deletion
                    let parent_id = merged
                        .nodes
                        .get(*nid)
                        .and_then(|n| n.parent_id.clone());
                    if let Some(parent_id) = parent_id {
                        if let Some(parent) = merged.nodes.get_mut(&parent_id) {
                            parent.children.retain(|c| c != *nid);
                        }
                    }
                    merged.nodes.remove(*nid);
                }
            }
        }
    }

    // 3. Nodes deleted by ours (in base but not in ours)
    for nid in &base_node_ids {
        if !ours_node_ids.contains(nid) && theirs_node_ids.contains(nid) {
            let theirs_node = theirs.nodes.get(*nid).unwrap();
            let base_node = base.nodes.get(*nid).unwrap();
            if theirs_node.content != base_node.content
                || theirs_node.metadata != base_node.metadata
            {
                conflicts.push(MergeConflict {
                    node_id: (*nid).clone(),
                    conflict_type: ConflictType::DeleteModifyConflict {
                        deleted_by: MergeSide::Ours,
                        modified_node: theirs_node.clone(),
                    },
                });
            }
            // If theirs didn't modify, ours' deletion stands (already not in merged)
        }
    }

    // 4. Nodes modified by both (in all three)
    for nid in &base_node_ids {
        if !ours_node_ids.contains(nid) || !theirs_node_ids.contains(nid) {
            continue;
        }
        let base_node = base.nodes.get(*nid).unwrap();
        let ours_node = ours.nodes.get(*nid).unwrap();
        let theirs_node = theirs.nodes.get(*nid).unwrap();

        let ours_changed =
            ours_node.content != base_node.content || ours_node.metadata != base_node.metadata;
        let theirs_changed =
            theirs_node.content != base_node.content || theirs_node.metadata != base_node.metadata;

        if ours_changed && theirs_changed {
            // Both changed — check if identical
            if ours_node.content == theirs_node.content
                && ours_node.metadata == theirs_node.metadata
            {
                // Identical changes, no conflict
            } else {
                conflicts.push(MergeConflict {
                    node_id: (*nid).clone(),
                    conflict_type: ConflictType::ContentConflict {
                        base: base_node.content.clone(),
                        ours: ours_node.content.clone(),
                        theirs: theirs_node.content.clone(),
                    },
                });
            }
        } else if theirs_changed && !ours_changed {
            // Only theirs changed, accept theirs
            if let Some(node) = merged.nodes.get_mut(*nid) {
                node.content = theirs_node.content.clone();
                node.metadata = theirs_node.metadata.clone();
            }
        }
        // If only ours changed, merged already has ours' version

        // Check parent changes (structural)
        let ours_parent_changed = ours_node.parent_id != base_node.parent_id;
        let theirs_parent_changed = theirs_node.parent_id != base_node.parent_id;
        if ours_parent_changed && theirs_parent_changed {
            if ours_node.parent_id != theirs_node.parent_id {
                conflicts.push(MergeConflict {
                    node_id: (*nid).clone(),
                    conflict_type: ConflictType::StructuralConflict {
                        base_parent: base_node.parent_id.clone().unwrap_or(NodeId("".to_string())),
                        ours_parent: ours_node
                            .parent_id
                            .clone()
                            .unwrap_or(NodeId("".to_string())),
                        theirs_parent: theirs_node
                            .parent_id
                            .clone()
                            .unwrap_or(NodeId("".to_string())),
                    },
                });
            }
        } else if theirs_parent_changed && !ours_parent_changed {
            // Accept theirs' reparent — collect info first to avoid borrow issues
            let old_parent_id = merged
                .nodes
                .get(*nid)
                .and_then(|n| n.parent_id.clone());
            let new_parent_id = theirs_node.parent_id.clone();
            let nid_clone = (*nid).clone();

            // Remove from old parent's children
            if let Some(ref old_pid) = old_parent_id {
                if let Some(old_parent) = merged.nodes.get_mut(old_pid) {
                    old_parent.children.retain(|c| c != &nid_clone);
                }
            }
            // Update node's parent
            if let Some(node) = merged.nodes.get_mut(*nid) {
                node.parent_id = new_parent_id.clone();
            }
            // Add to new parent's children
            if let Some(ref new_pid) = new_parent_id {
                if let Some(new_parent) = merged.nodes.get_mut(new_pid) {
                    if !new_parent.children.contains(&nid_clone) {
                        new_parent.children.push(nid_clone);
                    }
                }
            }
        }
    }

    // 5. Links — same logic
    let base_link_ids: HashSet<&LinkId> = base.links.keys().collect();
    let ours_link_ids: HashSet<&LinkId> = ours.links.keys().collect();
    let theirs_link_ids: HashSet<&LinkId> = theirs.links.keys().collect();

    // Links added by theirs
    for lid in &theirs_link_ids {
        if !base_link_ids.contains(lid) && !ours_link_ids.contains(lid) {
            let link = theirs.links.get(*lid).unwrap().clone();
            // Check if referenced nodes exist in merged
            if merged.nodes.contains_key(&link.from_node)
                && merged.nodes.contains_key(&link.to_node)
            {
                merged.links.insert((*lid).clone(), link);
            }
        }
    }

    // Links removed by theirs (in base but not theirs)
    for lid in &base_link_ids {
        if !theirs_link_ids.contains(lid) && ours_link_ids.contains(lid) {
            merged.links.remove(*lid);
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
        match &res.resolved_content {
            Some(content) => {
                // Keep the node with resolved content
                if let Some(node) = graph.nodes.get_mut(&res.node_id) {
                    node.content = content.clone();
                }
            }
            None => {
                // Confirm deletion — clone parent_id to avoid borrow conflict
                let parent_id = graph
                    .nodes
                    .get(&res.node_id)
                    .and_then(|n| n.parent_id.clone());
                if let Some(parent_id) = parent_id {
                    if let Some(parent) = graph.nodes.get_mut(&parent_id) {
                        parent.children.retain(|c| c != &res.node_id);
                    }
                }
                graph.nodes.remove(&res.node_id);
                // Remove links referencing deleted node
                let node_id = res.node_id.clone();
                graph.links.retain(|_, link| {
                    link.from_node != node_id && link.to_node != node_id
                });
            }
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
