use super::GitWorkspaceService;
use anyhow::{Context as _, anyhow};
use std::{
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
};

impl GitWorkspaceService {
    pub(super) fn context_root_dir(&self, project_slug: &str, workspace_name: &str) -> PathBuf {
        self.conversation_dir(project_slug, workspace_name)
            .join("context")
    }

    pub(super) fn context_blobs_dir(&self, project_slug: &str, workspace_name: &str) -> PathBuf {
        self.context_root_dir(project_slug, workspace_name)
            .join("blobs")
    }

    pub(super) fn context_tmp_dir(&self, project_slug: &str, workspace_name: &str) -> PathBuf {
        self.context_root_dir(project_slug, workspace_name)
            .join("tmp")
    }

    fn normalize_extension(ext: &str) -> anyhow::Result<String> {
        let trimmed = ext.trim().trim_start_matches('.').to_ascii_lowercase();
        if trimmed.is_empty() {
            return Err(anyhow!("missing extension"));
        }
        if trimmed.len() > 16 {
            return Err(anyhow!("extension too long"));
        }
        if !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        {
            return Err(anyhow!("invalid extension"));
        }
        Ok(trimmed)
    }

    pub(super) fn store_context_bytes(
        &self,
        project_slug: &str,
        workspace_name: &str,
        bytes: &[u8],
        extension: &str,
    ) -> anyhow::Result<PathBuf> {
        let extension = Self::normalize_extension(extension)?;
        let blobs_dir = self.context_blobs_dir(project_slug, workspace_name);
        std::fs::create_dir_all(&blobs_dir)
            .with_context(|| format!("failed to create {}", blobs_dir.display()))?;

        let hash = blake3::hash(bytes).to_hex().to_string();
        let dest = blobs_dir.join(format!("{hash}.{extension}"));
        if dest.exists() {
            return Ok(dest);
        }

        let tmp_dir = self.context_tmp_dir(project_slug, workspace_name);
        std::fs::create_dir_all(&tmp_dir)
            .with_context(|| format!("failed to create {}", tmp_dir.display()))?;
        let tmp = tmp_dir.join(format!("import-{}", rand::random::<u64>()));

        {
            let mut f = std::fs::File::create(&tmp)
                .with_context(|| format!("failed to create {}", tmp.display()))?;
            f.write_all(bytes)
                .with_context(|| format!("failed to write {}", tmp.display()))?;
            f.sync_all()
                .with_context(|| format!("failed to sync {}", tmp.display()))?;
        }

        if dest.exists() {
            let _ = std::fs::remove_file(&tmp);
            return Ok(dest);
        }

        std::fs::rename(&tmp, &dest).with_context(|| {
            format!(
                "failed to move context blob {} -> {}",
                tmp.display(),
                dest.display()
            )
        })?;
        Ok(dest)
    }

    pub(super) fn store_context_file_internal(
        &self,
        project_slug: &str,
        workspace_name: &str,
        source_path: &Path,
    ) -> anyhow::Result<PathBuf> {
        let extension = source_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("txt");
        let extension = Self::normalize_extension(extension)?;

        let blobs_dir = self.context_blobs_dir(project_slug, workspace_name);
        std::fs::create_dir_all(&blobs_dir)
            .with_context(|| format!("failed to create {}", blobs_dir.display()))?;

        let tmp_dir = self.context_tmp_dir(project_slug, workspace_name);
        std::fs::create_dir_all(&tmp_dir)
            .with_context(|| format!("failed to create {}", tmp_dir.display()))?;
        let tmp = tmp_dir.join(format!("import-{}", rand::random::<u64>()));

        let mut src = std::fs::File::open(source_path)
            .with_context(|| format!("failed to open {}", source_path.display()))?;
        let mut dst = std::fs::File::create(&tmp)
            .with_context(|| format!("failed to create {}", tmp.display()))?;

        let mut hasher = blake3::Hasher::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = src.read(&mut buf).context("failed to read source file")?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            dst.write_all(&buf[..n])
                .context("failed to write tmp file")?;
        }
        dst.sync_all()
            .with_context(|| format!("failed to sync {}", tmp.display()))?;

        let hash = hasher.finalize().to_hex().to_string();
        let dest = blobs_dir.join(format!("{hash}.{extension}"));
        if dest.exists() {
            let _ = std::fs::remove_file(&tmp);
            return Ok(dest);
        }

        std::fs::rename(&tmp, &dest).with_context(|| {
            format!(
                "failed to move context blob {} -> {}",
                tmp.display(),
                dest.display()
            )
        })?;
        Ok(dest)
    }
}
