default:
  @just --list

fmt:
  cargo fmt --all

lint:
  cargo clippy --workspace --all-targets --all-features --no-deps -- -D warnings

test:
  sh -eu -c 'root="$(mktemp -d -t luban-test-XXXXXX)"; trap "rm -rf \"$root\"" EXIT; LUBAN_ROOT="$root" cargo test --workspace --all-targets --all-features'

test-fast:
  sh -eu -c 'root="$(mktemp -d -t luban-test-XXXXXX)"; trap "rm -rf \"$root\"" EXIT; LUBAN_ROOT="$root" cargo test -p luban_domain'

web cmd profile="debug":
  if [ "{{cmd}}" = "build" ]; then \
    if ! command -v pnpm >/dev/null 2>&1; then \
      echo "pnpm not found; install pnpm to build the web UI"; \
      exit 1; \
    fi; \
    if [ -d web ]; then \
      (cd web && pnpm install); \
      (cd web && pnpm build); \
      mkdir -p web/out; \
      printf '\n' > web/out/.gitkeep; \
    fi; \
  elif [ "{{cmd}}" = "run" ]; then \
    just web build "{{profile}}"; \
    if [ "{{profile}}" = "release" ]; then \
      cargo run -p luban_server --release; \
    elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
      cargo run -p luban_server; \
    else \
      cargo run -p luban_server --profile "{{profile}}"; \
    fi; \
  else \
    echo "usage: just web {build|run} [release]"; \
    exit 2; \
  fi

app cmd profile="debug":
  if [ "{{cmd}}" = "build" ]; then \
    just web build "{{profile}}"; \
    if [ "{{profile}}" = "release" ]; then \
      cargo build -p luban_tauri --release; \
    elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
      cargo build -p luban_tauri; \
    else \
      cargo build -p luban_tauri --profile "{{profile}}"; \
    fi; \
  elif [ "{{cmd}}" = "run" ]; then \
    just web build "{{profile}}"; \
    if [ "{{profile}}" = "release" ]; then \
      cargo run -p luban_tauri --release; \
    elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
      cargo run -p luban_tauri; \
    else \
      cargo run -p luban_tauri --profile "{{profile}}"; \
    fi; \
  else \
    echo "usage: just app {build|run} [release]"; \
    exit 2; \
  fi

test-ui:
  if ! command -v pnpm >/dev/null 2>&1; then \
    echo "pnpm not found; cannot run Playwright tests"; \
    exit 1; \
  fi; \
  (cd web && pnpm test:e2e)

test-ui-headed:
  if ! command -v pnpm >/dev/null 2>&1; then \
    echo "pnpm not found; cannot run Playwright tests"; \
    exit 1; \
  fi; \
  (cd web && pnpm test:e2e:headed)

run profile="debug":
  just web run "{{profile}}"

run-server profile="debug":
  if [ "{{profile}}" = "release" ]; then \
    cargo run -p luban_server --release; \
  elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
    cargo run -p luban_server; \
  else \
    cargo run -p luban_server --profile "{{profile}}"; \
  fi

build profile="debug":
  just app build "{{profile}}"

build-server profile="debug":
  if [ "{{profile}}" = "release" ]; then \
    cargo build -p luban_server --release; \
  elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
    cargo build -p luban_server; \
  else \
    cargo build -p luban_server --profile "{{profile}}"; \
  fi

ci: fmt lint test

package target profile="release":
  if ! cargo tauri --help >/dev/null 2>&1; then \
    echo "cargo-tauri CLI not found; install it via: cargo install tauri-cli"; \
    exit 1; \
  fi; \
  if [ "{{target}}" != "darwin-aarch64" ] && [ "{{target}}" != "darwin-x86_64" ] && [ "{{target}}" != "darwin-universal" ]; then \
    echo "unsupported target: {{target}}"; \
    echo "supported targets: darwin-aarch64, darwin-x86_64, darwin-universal"; \
    exit 2; \
  fi; \
  if [ -z "${TAURI_PRIVATE_KEY:-}" ] && [ -z "${TAURI_PRIVATE_KEY_PATH:-}" ]; then \
    echo "missing signing key; set TAURI_PRIVATE_KEY or TAURI_PRIVATE_KEY_PATH (and optional TAURI_PRIVATE_KEY_PASSWORD)"; \
    exit 1; \
  fi; \
  just web build "{{profile}}"; \
  profile="{{profile}}"; \
  target_key="{{target}}"; \
  target_triple=""; \
  platform_key=""; \
  case "$target_key" in \
    darwin-aarch64) target_triple="aarch64-apple-darwin"; platform_key="darwin-aarch64";; \
    darwin-x86_64) target_triple="x86_64-apple-darwin"; platform_key="darwin-x86_64";; \
    darwin-universal) target_triple="universal-apple-darwin"; platform_key="darwin-universal";; \
    *) echo "unsupported target: $target_key" >&2; exit 2;; \
  esac; \
  build_dir="release"; \
  build_flags=""; \
  if [ "$profile" = "release" ]; then \
    build_dir="release"; \
    build_flags=""; \
  elif [ "$profile" = "debug" ] || [ "$profile" = "dev" ]; then \
    build_dir="debug"; \
    build_flags="--debug"; \
  else \
    echo "usage: just package {darwin-aarch64|darwin-x86_64|darwin-universal} [release|debug]"; \
    exit 2; \
  fi; \
  target_flag="--target $target_triple"; \
  (cd crates/luban_tauri && cargo tauri build --ci --bundles app $build_flags $target_flag); \
  version="$(cargo metadata --no-deps --format-version 1 | python3 -c 'import json,sys; d=json.load(sys.stdin); pkgs=d.get(\"packages\",[]); v=None\nfor p in pkgs:\n  if p.get(\"name\")==\"luban_tauri\":\n    v=p.get(\"version\"); break\nif not v: raise SystemExit(\"failed to resolve luban_tauri version\")\nprint(v)')"; \
  bundle_root="crates/luban_tauri/target/$target_triple"; \
  bundle_macos="$bundle_root/$build_dir/bundle/macos"; \
  app_archive="$(find "$bundle_macos" -maxdepth 2 -type f -name \"*.app.tar.gz\" | head -n 1 || true)"; \
  app_path=""; \
  if [ -z "$app_archive" ]; then \
    app_path="$(find "$bundle_macos" -maxdepth 2 -type d -name \"*.app\" | head -n 1 || true)"; \
  fi; \
  if [ -z "$app_archive" ] && [ -z "$app_path" ]; then \
    echo "macOS bundle not found under: $bundle_macos" >&2; \
    exit 1; \
  fi; \
  out_dir=".context/package"; \
  mkdir -p "$out_dir"; \
  archive_name="Luban_${version}_${platform_key}.app.tar.gz"; \
  archive_path="$out_dir/$archive_name"; \
  if [ -n "$app_archive" ]; then \
    cp "$app_archive" "$archive_path"; \
  else \
    tar -C "$(dirname "$app_path")" -czf "$archive_path" "$(basename "$app_path")"; \
  fi; \
  sig_path="$archive_path.sig"; \
  cargo tauri signer sign "$archive_path" > "$sig_path"; \
  base_url="${LUBAN_RELEASE_BASE_URL:-https://releases.luban.dev}"; \
  pub_date="$(date -u +\"%Y-%m-%dT%H:%M:%SZ\")"; \
  manifest_path="$out_dir/latest.json"; \
  LUBAN_PACKAGE_VERSION="$version" \
  LUBAN_PACKAGE_PLATFORM_KEY="$platform_key" \
  LUBAN_PACKAGE_ARCHIVE_BASENAME="$archive_name" \
  LUBAN_PACKAGE_SIGNATURE_PATH="$sig_path" \
  LUBAN_RELEASE_BASE_URL="$base_url" \
  LUBAN_PUB_DATE="$pub_date" \
  python3 -c 'import json,os\nfrom pathlib import Path\nversion=os.environ[\"LUBAN_PACKAGE_VERSION\"]\nplatform_key=os.environ[\"LUBAN_PACKAGE_PLATFORM_KEY\"]\narchive=os.environ[\"LUBAN_PACKAGE_ARCHIVE_BASENAME\"]\nbase=os.environ[\"LUBAN_RELEASE_BASE_URL\"].rstrip(\"/\")\nsig=Path(os.environ[\"LUBAN_PACKAGE_SIGNATURE_PATH\"]).read_text(encoding=\"utf-8\")\nurl=f\"{base}/{archive}\"\nplatforms={}\nif platform_key==\"darwin-universal\":\n  platforms[\"darwin-aarch64\"]={\"url\": url, \"signature\": sig}\n  platforms[\"darwin-x86_64\"]={\"url\": url, \"signature\": sig}\nelse:\n  platforms[platform_key]={\"url\": url, \"signature\": sig}\nmanifest={\"version\": version, \"notes\": \"\", \"pub_date\": os.environ[\"LUBAN_PUB_DATE\"], \"platforms\": platforms}\nPath(\"'"$manifest_path"'\").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+\"\\n\", encoding=\"utf-8\")'; \
  printf "LUBAN_PACKAGE_VERSION=%s\nLUBAN_PACKAGE_PLATFORM_KEY=%s\nLUBAN_PACKAGE_ARCHIVE=%s\nLUBAN_PACKAGE_SIGNATURE=%s\nLUBAN_PACKAGE_MANIFEST=%s\n" \
    "$version" "$platform_key" "$archive_path" "$sig_path" "$manifest_path" > "$out_dir/package.env"; \
  echo "packaged: $archive_path"; \
  echo "manifest: $manifest_path"; \
  echo "next: just upload"

upload:
  if [ ! -f .context/package/package.env ]; then \
    echo "missing .context/package/package.env; run: just package darwin-aarch64"; \
    exit 1; \
  fi; \
  if ! command -v aws >/dev/null 2>&1; then \
    echo "aws CLI not found; install awscli to upload to Cloudflare R2"; \
    exit 1; \
  fi; \
  if [ -z "${R2_BUCKET:-}" ] || [ -z "${R2_ENDPOINT_URL:-}" ]; then \
    echo "missing R2 config; set R2_BUCKET and R2_ENDPOINT_URL"; \
    exit 1; \
  fi; \
  if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then \
    echo "missing AWS credentials; set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for Cloudflare R2"; \
    exit 1; \
  fi; \
  set -a; . .context/package/package.env; set +a; \
  AWS_EC2_METADATA_DISABLED=1; export AWS_EC2_METADATA_DISABLED; \
  if [ -z "${AWS_DEFAULT_REGION:-}" ]; then AWS_DEFAULT_REGION=auto; export AWS_DEFAULT_REGION; fi; \
  archive_path="$LUBAN_PACKAGE_ARCHIVE"; \
  sig_path="$LUBAN_PACKAGE_SIGNATURE"; \
  manifest_path="$LUBAN_PACKAGE_MANIFEST"; \
  archive_name="$(basename "$archive_path")"; \
  echo "uploading: $archive_name"; \
  aws --endpoint-url "$R2_ENDPOINT_URL" s3 cp "$archive_path" "s3://$R2_BUCKET/$archive_name" --cache-control "public, max-age=31536000, immutable" --content-type "application/gzip"; \
  aws --endpoint-url "$R2_ENDPOINT_URL" s3 cp "$sig_path" "s3://$R2_BUCKET/$archive_name.sig" --cache-control "public, max-age=31536000, immutable" --content-type "text/plain; charset=utf-8"; \
  aws --endpoint-url "$R2_ENDPOINT_URL" s3 cp "$manifest_path" "s3://$R2_BUCKET/latest.json" --cache-control "no-cache" --content-type "application/json; charset=utf-8"; \
  echo "uploaded manifest: ${LUBAN_RELEASE_BASE_URL:-https://releases.luban.dev}/latest.json"
