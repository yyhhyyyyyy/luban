use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn repo_root_from_manifest_dir(manifest_dir: &Path) -> PathBuf {
    // crates/luban_server -> crates -> repo root
    manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .expect("failed to locate repo root from CARGO_MANIFEST_DIR")
}

fn extract_server_routes(server_src: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut cursor = 0;
    while let Some(found) = server_src[cursor..].find(".route(") {
        cursor += found + ".route(".len();
        let rest = &server_src[cursor..];
        let Some(first_quote) = rest.find('"') else {
            break;
        };
        let start = cursor + first_quote + 1;
        let Some(end_rel) = server_src[start..].find('"') else {
            break;
        };
        let end = start + end_rel;
        let path = &server_src[start..end];
        if path.starts_with('/') {
            out.insert(format!("/api{path}"));
        }
        cursor = end + 1;
    }
    out
}

fn extract_contract_paths(progress_md: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for line in progress_md.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("| C-") {
            continue;
        }
        let Some(tick1) = trimmed.find('`') else {
            continue;
        };
        let Some(tick2) = trimmed[tick1 + 1..].find('`') else {
            continue;
        };
        let surface = &trimmed[tick1 + 1..tick1 + 1 + tick2];
        let mut parts = surface.split_whitespace();
        let _method = parts.next();
        let path = parts.next();
        let Some(path) = path else {
            continue;
        };
        if path.starts_with("/api/") {
            out.insert(path.to_string());
        }
    }
    out
}

#[test]
fn contracts_progress_covers_all_server_routes() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = repo_root_from_manifest_dir(&manifest_dir);

    let server_rs = manifest_dir.join("src/server.rs");
    let progress_md = repo_root.join("docs/contracts/progress.md");

    let server_src =
        fs::read_to_string(&server_rs).expect("failed to read crates/luban_server/src/server.rs");
    let progress_src =
        fs::read_to_string(&progress_md).expect("failed to read docs/contracts/progress.md");

    let server_paths = extract_server_routes(&server_src);
    let contract_paths = extract_contract_paths(&progress_src);

    assert!(
        !server_paths.is_empty(),
        "expected server routes to be discoverable from src/server.rs"
    );
    assert!(
        !contract_paths.is_empty(),
        "expected contract surfaces to be discoverable from docs/contracts/progress.md"
    );

    let missing: Vec<String> = server_paths.difference(&contract_paths).cloned().collect();

    assert!(
        missing.is_empty(),
        "docs/contracts/progress.md is missing contract entries for server routes:\n{}",
        missing.join("\n")
    );
}
