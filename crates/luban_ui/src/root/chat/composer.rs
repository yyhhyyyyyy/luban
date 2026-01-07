use super::super::*;

const MAX_INLINE_PASTE_CHARS: usize = 8_000;
const MAX_INLINE_PASTE_LINES: usize = 200;

#[derive(Clone, Debug)]
pub(in crate::root) enum ContextImportSpec {
    Image { extension: String, bytes: Vec<u8> },
    Text { extension: String, text: String },
    File { source_path: PathBuf },
}

fn should_inline_paste_text(text: &str) -> bool {
    if text.chars().count() > MAX_INLINE_PASTE_CHARS {
        return false;
    }
    if text.lines().count() > MAX_INLINE_PASTE_LINES {
        return false;
    }
    true
}

pub(in crate::root) fn is_text_like_extension(path: &std::path::Path) -> bool {
    let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "txt"
            | "md"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "rs"
            | "go"
            | "py"
            | "js"
            | "ts"
            | "jsx"
            | "tsx"
            | "html"
            | "css"
            | "log"
            | "csv"
    )
}

fn image_format_extension(format: gpui::ImageFormat) -> Option<&'static str> {
    match format {
        gpui::ImageFormat::Png => Some("png"),
        gpui::ImageFormat::Jpeg => Some("jpg"),
        gpui::ImageFormat::Webp => Some("webp"),
        gpui::ImageFormat::Bmp => Some("bmp"),
        gpui::ImageFormat::Tiff => Some("tiff"),
        gpui::ImageFormat::Ico => Some("ico"),
        gpui::ImageFormat::Svg => Some("svg"),
        gpui::ImageFormat::Gif => Some("gif"),
    }
}

pub(in crate::root) fn context_import_plan_from_clipboard(
    clipboard: &gpui::ClipboardItem,
) -> (Option<String>, Vec<ContextImportSpec>) {
    let mut inline_text = clipboard.text().unwrap_or_default();
    let mut imports: Vec<ContextImportSpec> = Vec::new();

    for entry in clipboard.entries() {
        match entry {
            gpui::ClipboardEntry::Image(image) => {
                let Some(ext) = image_format_extension(image.format) else {
                    continue;
                };
                imports.push(ContextImportSpec::Image {
                    extension: ext.to_owned(),
                    bytes: image.bytes.clone(),
                });
            }
            gpui::ClipboardEntry::ExternalPaths(paths) => {
                for path in paths.paths() {
                    let path = path.to_path_buf();
                    if !is_text_like_extension(&path) {
                        continue;
                    }
                    imports.push(ContextImportSpec::File { source_path: path });
                }
            }
            gpui::ClipboardEntry::String(_) => {}
        }
    }

    if !inline_text.is_empty() && !should_inline_paste_text(&inline_text) {
        imports.push(ContextImportSpec::Text {
            extension: "txt".to_owned(),
            text: inline_text,
        });
        inline_text = String::new();
    }

    let inline_text = if inline_text.is_empty() {
        None
    } else {
        Some(inline_text)
    };

    (inline_text, imports)
}
