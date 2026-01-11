use super::GitWorkspaceService;
use anyhow::{Context as _, anyhow};
use std::{ffi::OsStr, path::Path, path::PathBuf, process::Command};

impl GitWorkspaceService {
    pub(super) fn run_git<I, S>(&self, repo_path: &Path, args: I) -> anyhow::Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .output()
            .context("failed to spawn git")?;

        if !output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!(
                "git failed ({}):\nstdout:\n{}\nstderr:\n{}",
                output.status,
                stdout.trim(),
                stderr.trim()
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    pub(super) fn select_remote(&self, repo_path: &Path) -> anyhow::Result<String> {
        let out = self.run_git(repo_path, ["remote"])?;
        let remotes = out
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();

        if remotes.contains(&"origin") {
            return Ok("origin".to_owned());
        }

        if remotes.len() == 1 {
            return Ok(remotes[0].to_owned());
        }

        Err(anyhow!("cannot select remote: found {:?}", remotes))
    }

    pub(super) fn resolve_default_upstream_ref(
        &self,
        repo_path: &Path,
        remote: &str,
    ) -> anyhow::Result<String> {
        let head_ref = self
            .run_git(
                repo_path,
                [
                    "symbolic-ref",
                    "--quiet",
                    &format!("refs/remotes/{remote}/HEAD"),
                ],
            )
            .context("failed to resolve remote HEAD ref (missing refs/remotes/<remote>/HEAD?)")?;

        let prefix = format!("refs/remotes/{remote}/");
        let Some(branch) = head_ref.strip_prefix(&prefix) else {
            return Err(anyhow!("unexpected remote HEAD ref: {head_ref}"));
        };

        let verify_ref = format!("refs/remotes/{remote}/{branch}");
        self.run_git(repo_path, ["show-ref", "--verify", "--quiet", &verify_ref])
            .with_context(|| format!("remote default branch ref not found: {verify_ref}"))?;

        Ok(format!("{remote}/{branch}"))
    }

    pub(super) fn repo_root(&self, repo_path: &Path) -> anyhow::Result<PathBuf> {
        let root = self
            .run_git(repo_path, ["rev-parse", "--show-toplevel"])
            .context("failed to resolve git repository root")?;
        let trimmed = root.trim();
        if trimmed.is_empty() {
            return Err(anyhow!("git rev-parse returned empty root"));
        }
        Ok(PathBuf::from(trimmed))
    }

    pub(super) fn select_remote_best_effort(
        &self,
        repo_path: &Path,
    ) -> anyhow::Result<Option<String>> {
        let out = self.run_git(repo_path, ["remote"])?;
        let remotes = out
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();

        if remotes.is_empty() {
            return Ok(None);
        }
        if remotes.contains(&"origin") {
            return Ok(Some("origin".to_owned()));
        }
        Ok(Some(remotes[0].to_owned()))
    }

    pub(super) fn github_repo_id_from_remote_url(url: &str) -> Option<String> {
        let trimmed = url.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return None;
        }

        let (host, path) = if let Some(rest) = trimmed.strip_prefix("git@") {
            // git@github.com:owner/repo(.git)
            rest.split_once(':')?
        } else if let Some(rest) = trimmed.strip_prefix("ssh://") {
            // ssh://git@github.com/owner/repo(.git)
            let rest = rest.strip_prefix("git@").unwrap_or(rest);
            rest.split_once('/')?
        } else if let Some(rest) = trimmed.strip_prefix("https://") {
            let mut parts = rest.splitn(2, '/');
            let host = parts.next()?;
            let path = parts.next().unwrap_or_default();
            (host, path)
        } else if let Some(rest) = trimmed.strip_prefix("http://") {
            let mut parts = rest.splitn(2, '/');
            let host = parts.next()?;
            let path = parts.next().unwrap_or_default();
            (host, path)
        } else {
            return None;
        };

        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }

        let path = path.trim_start_matches('/').trim_end_matches(".git");
        let mut iter = path.split('/').filter(|s| !s.is_empty());
        let owner = iter.next()?;
        let repo = iter.next()?;

        Some(format!(
            "github.com/{}/{}",
            owner.to_ascii_lowercase(),
            repo.to_ascii_lowercase()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::GitWorkspaceService;

    #[test]
    fn github_repo_id_from_remote_url_parses_https() {
        assert_eq!(
            GitWorkspaceService::github_repo_id_from_remote_url(
                "https://github.com/apache/opendal"
            ),
            Some("github.com/apache/opendal".to_owned())
        );
        assert_eq!(
            GitWorkspaceService::github_repo_id_from_remote_url(
                "https://github.com/apache/opendal.git"
            ),
            Some("github.com/apache/opendal".to_owned())
        );
    }

    #[test]
    fn github_repo_id_from_remote_url_parses_ssh() {
        assert_eq!(
            GitWorkspaceService::github_repo_id_from_remote_url(
                "git@github.com:apache/opendal.git"
            ),
            Some("github.com/apache/opendal".to_owned())
        );
        assert_eq!(
            GitWorkspaceService::github_repo_id_from_remote_url(
                "ssh://git@github.com/apache/opendal.git"
            ),
            Some("github.com/apache/opendal".to_owned())
        );
    }

    #[test]
    fn github_repo_id_from_remote_url_ignores_non_github() {
        assert_eq!(
            GitWorkspaceService::github_repo_id_from_remote_url(
                "https://gitlab.com/apache/opendal"
            ),
            None
        );
    }
}
