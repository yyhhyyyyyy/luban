use anyhow::Context as _;
use std::path::PathBuf;
use std::process::Command;

const SHELL_ENV_DELIMITER: &str = "_SHELL_ENV_DELIMITER_";

fn default_shell() -> &'static str {
    if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/sh"
    }
}

fn shell_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

/// Reads the login shell configuration and applies selected environment variables.
///
/// This is primarily needed on macOS when the app is launched from Finder/Dock:
/// GUI apps do not reliably inherit the user's shell environment, which can
/// cause subprocess discovery to fail (e.g. `codex`, `git`, `rg`).
fn fix_vars(vars: &[&str]) -> anyhow::Result<()> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| default_shell().to_owned());
    let mut cmd = Command::new(shell);
    cmd.arg("-ilc")
        .arg(format!(
            "echo -n \"{SHELL_ENV_DELIMITER}\"; env; echo -n \"{SHELL_ENV_DELIMITER}\"; exit"
        ))
        // Oh My Zsh can run auto-update logic in interactive shells, which may block.
        .env("DISABLE_AUTO_UPDATE", "true");

    if let Some(home) = shell_home_dir() {
        cmd.current_dir(home);
    }

    let output = cmd.output().context("failed to run login shell")?;
    if !output.status.success() {
        anyhow::bail!(
            "login shell exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let env_block = stdout
        .split(SHELL_ENV_DELIMITER)
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("invalid shell env output"))?;

    for line in env_block.lines().filter(|l| !l.trim().is_empty()) {
        let mut parts = line.splitn(2, '=');
        let Some(key) = parts.next() else { continue };
        let Some(value) = parts.next() else { continue };
        if vars.is_empty() || vars.contains(&key) {
            unsafe {
                std::env::set_var(key, value);
            }
        }
    }

    Ok(())
}

pub fn fix_path_env() -> anyhow::Result<()> {
    fix_vars(&["PATH"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fix_path_is_noop_off_macos() {
        if cfg!(target_os = "macos") {
            return;
        }
        fix_path_env().expect("should not fail off macOS");
    }

    #[test]
    fn fix_path_env_reads_shell_env_output() {
        if !cfg!(target_os = "macos") {
            return;
        }

        let dir = std::env::temp_dir().join(format!(
            "luban-tauri-fix-path-env-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");

        let shell = dir.join("fake-shell");
        let expected_path = "/opt/test/bin:/usr/bin";
        let script = format!(
            "#!/bin/sh\n\
echo -n \"{d}\"\n\
echo \"PATH={p}\"\n\
echo \"HOME=/tmp\"\n\
echo -n \"{d}\"\n",
            d = SHELL_ENV_DELIMITER,
            p = expected_path
        );
        std::fs::write(&shell, script).expect("write fake shell");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&shell).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&shell, perms).unwrap();
        }

        let prev_shell = std::env::var_os("SHELL");
        let prev_path = std::env::var_os("PATH");

        unsafe {
            std::env::set_var("SHELL", shell.as_os_str());
            std::env::set_var("PATH", "/usr/bin");
        }

        fix_path_env().expect("fix path must succeed");
        assert_eq!(std::env::var("PATH").unwrap(), expected_path);

        unsafe {
            if let Some(value) = prev_shell {
                std::env::set_var("SHELL", value);
            } else {
                std::env::remove_var("SHELL");
            }
            if let Some(value) = prev_path {
                std::env::set_var("PATH", value);
            } else {
                std::env::remove_var("PATH");
            }
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
