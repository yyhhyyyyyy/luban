use anyhow::Context as _;
use std::net::SocketAddr;
use std::path::PathBuf;
use tauri::{Manager as _, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("unsupported url scheme".to_owned());
    }
    open::that(url).map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_web_dist(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("web").join("out"),
            resource_dir.join("out"),
            resource_dir.join("web_out"),
        ];
        for c in candidates {
            if c.join("index.html").exists() {
                return c;
            }
        }
    }

    PathBuf::from("web/out")
}

fn resolve_server_addr() -> anyhow::Result<SocketAddr> {
    // Use a random available port by default.
    //
    // This avoids launch failures when another Luban instance is already running
    // (common during development and when testing release bundles).
    let default_addr = "127.0.0.1:0";
    let addr: SocketAddr = std::env::var("LUBAN_SERVER_ADDR")
        .unwrap_or_else(|_| default_addr.to_owned())
        .parse()
        .context("invalid LUBAN_SERVER_ADDR")?;
    Ok(addr)
}

fn main() -> anyhow::Result<()> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_external])
        .setup(|app| {
            let handle = app.handle();
            let web_dist = resolve_web_dist(handle);
            unsafe {
                std::env::set_var("LUBAN_WEB_DIST_DIR", &web_dist);
            }

            let server = tauri::async_runtime::block_on(async {
                let addr = resolve_server_addr()?;
                luban_server::start_server(addr).await
            })
            .context("failed to start luban_server")?;

            let url: tauri::Url = format!("http://{}/", server.addr)
                .parse()
                .context("invalid server url")?;

            app.manage(server);

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Luban")
                .inner_size(1280.0, 800.0)
                .build()
                .context("failed to build window")?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .context("tauri runtime failed")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_addr_defaults_to_random_port() {
        let prev = std::env::var_os("LUBAN_SERVER_ADDR");
        unsafe {
            std::env::remove_var("LUBAN_SERVER_ADDR");
        }
        let addr = resolve_server_addr().expect("default addr must parse");
        assert_eq!(addr.ip().to_string(), "127.0.0.1");
        assert_eq!(addr.port(), 0);
        if let Some(value) = prev {
            unsafe {
                std::env::set_var("LUBAN_SERVER_ADDR", value);
            }
        }
    }

    #[test]
    fn tauri_capability_allows_any_localhost_port() {
        let contents = include_str!("../capabilities/main.json");
        assert!(
            contents.contains("http://127.0.0.1:*/*"),
            "capability must allow 127.0.0.1 on any port"
        );
        assert!(
            contents.contains("http://localhost:*/*"),
            "capability must allow localhost on any port"
        );
    }
}
