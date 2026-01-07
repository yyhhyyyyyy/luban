use super::GitWorkspaceService;
use anyhow::{Context as _, anyhow};
use std::{
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
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

    fn sanitize_basename(input: &str) -> String {
        let trimmed = input.trim();
        let mut sanitized = String::with_capacity(trimmed.len());
        for ch in trimmed.chars() {
            if ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                sanitized.push(ch);
            } else {
                sanitized.push('-');
            }
        }

        let mut collapsed = String::with_capacity(sanitized.len());
        let mut last_dash = false;
        for ch in sanitized.chars() {
            if ch == '-' {
                if last_dash {
                    continue;
                }
                last_dash = true;
            } else {
                last_dash = false;
            }
            collapsed.push(ch);
        }

        let collapsed = collapsed.trim_matches(|ch: char| ch == '-' || ch == '.');
        let collapsed = if collapsed.is_empty() {
            "file"
        } else {
            collapsed
        };

        let mut limited = String::new();
        for ch in collapsed.chars().take(80) {
            limited.push(ch);
        }
        if limited.is_empty() {
            "file".to_owned()
        } else {
            limited
        }
    }

    fn format_now_suffix_utc() -> String {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let days = secs / 86_400;
        let sec_of_day = (secs % 86_400) as u32;
        let hour = sec_of_day / 3_600;
        let minute = (sec_of_day % 3_600) / 60;
        let second = sec_of_day % 60;

        let (year, month, day) = Self::civil_from_days(days);
        format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
    }

    fn civil_from_days(days: i64) -> (i32, u32, u32) {
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = mp + if mp < 10 { 3 } else { -9 };
        let y = y + if m <= 2 { 1 } else { 0 };
        (y as i32, m as u32, d as u32)
    }

    fn next_available_blob_path(
        blobs_dir: &Path,
        basename: &str,
        suffix: &str,
        extension: &str,
    ) -> PathBuf {
        for attempt in 0u32..10_000 {
            let file_name = if attempt == 0 {
                format!("{basename}-{suffix}.{extension}")
            } else {
                format!("{basename}-{suffix}-{attempt}.{extension}")
            };
            let dest = blobs_dir.join(file_name);
            if !dest.exists() {
                return dest;
            }
        }

        blobs_dir.join(format!(
            "{basename}-{suffix}-{}.{}",
            rand::random::<u64>(),
            extension
        ))
    }

    pub(super) fn store_context_bytes(
        &self,
        project_slug: &str,
        workspace_name: &str,
        bytes: &[u8],
        extension: &str,
        basename: &str,
    ) -> anyhow::Result<PathBuf> {
        let extension = Self::normalize_extension(extension)?;
        let basename = Self::sanitize_basename(basename);
        let suffix = Self::format_now_suffix_utc();
        let blobs_dir = self.context_blobs_dir(project_slug, workspace_name);
        std::fs::create_dir_all(&blobs_dir)
            .with_context(|| format!("failed to create {}", blobs_dir.display()))?;

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

        for _ in 0..32 {
            let dest = Self::next_available_blob_path(&blobs_dir, &basename, &suffix, &extension);
            if dest.exists() {
                continue;
            }
            match std::fs::rename(&tmp, &dest) {
                Ok(()) => return Ok(dest),
                Err(err) if dest.exists() => continue,
                Err(err) => {
                    return Err(err).with_context(|| {
                        format!(
                            "failed to move context blob {} -> {}",
                            tmp.display(),
                            dest.display()
                        )
                    });
                }
            }
        }

        let _ = std::fs::remove_file(&tmp);
        Err(anyhow!(
            "failed to find a unique destination for context blob"
        ))
    }

    pub(super) fn store_context_file_internal(
        &self,
        project_slug: &str,
        workspace_name: &str,
        source_path: &Path,
    ) -> anyhow::Result<PathBuf> {
        let basename = source_path
            .file_stem()
            .map(|s| s.to_string_lossy())
            .unwrap_or_else(|| std::borrow::Cow::Borrowed("file"));
        let basename = Self::sanitize_basename(&basename);

        let extension = source_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("txt");
        let extension = Self::normalize_extension(extension)?;

        let blobs_dir = self.context_blobs_dir(project_slug, workspace_name);
        std::fs::create_dir_all(&blobs_dir)
            .with_context(|| format!("failed to create {}", blobs_dir.display()))?;

        let suffix = Self::format_now_suffix_utc();

        let tmp_dir = self.context_tmp_dir(project_slug, workspace_name);
        std::fs::create_dir_all(&tmp_dir)
            .with_context(|| format!("failed to create {}", tmp_dir.display()))?;
        let tmp = tmp_dir.join(format!("import-{}", rand::random::<u64>()));

        let mut src = std::fs::File::open(source_path)
            .with_context(|| format!("failed to open {}", source_path.display()))?;
        let mut dst = std::fs::File::create(&tmp)
            .with_context(|| format!("failed to create {}", tmp.display()))?;

        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = src.read(&mut buf).context("failed to read source file")?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n])
                .context("failed to write tmp file")?;
        }
        dst.sync_all()
            .with_context(|| format!("failed to sync {}", tmp.display()))?;

        for _ in 0..32 {
            let dest = Self::next_available_blob_path(&blobs_dir, &basename, &suffix, &extension);
            if dest.exists() {
                continue;
            }
            match std::fs::rename(&tmp, &dest) {
                Ok(()) => return Ok(dest),
                Err(err) if dest.exists() => continue,
                Err(err) => {
                    return Err(err).with_context(|| {
                        format!(
                            "failed to move context blob {} -> {}",
                            tmp.display(),
                            dest.display()
                        )
                    });
                }
            }
        }

        let _ = std::fs::remove_file(&tmp);
        Err(anyhow!(
            "failed to find a unique destination for context blob"
        ))
    }
}
