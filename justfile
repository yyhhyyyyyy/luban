default:
  @just --list

sidecar-build:
  mkdir -p tools/codex_sidecar/dist
  if [ -f tools/codex_sidecar/dist/run.mjs ] && [ -d tools/codex_sidecar/vendor ]; then exit 0; fi
  cd tools/codex_sidecar && npm ci --no-fund --no-audit && npm run bundle

sidecar-install: sidecar-build

zig-bootstrap:
  bash tools/bootstrap-zig.sh

fmt:
  cargo fmt --all

lint:
  cargo clippy --workspace --all-targets --all-features --no-deps -- -D warnings

test:
  cargo test --workspace --all-targets --all-features

test-fast:
  cargo test -p luban_domain

run profile="debug":
  if [ "{{profile}}" = "release" ]; then \
    cargo run -p luban_app --release; \
  elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
    cargo run -p luban_app; \
  else \
    cargo run -p luban_app --profile "{{profile}}"; \
  fi

build profile="debug":
  if [ "{{profile}}" = "release" ]; then \
    cargo build -p luban_app --release; \
  elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
    cargo build -p luban_app; \
  else \
    cargo build -p luban_app --profile "{{profile}}"; \
  fi

ci: fmt lint test
