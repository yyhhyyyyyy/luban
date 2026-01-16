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

package profile="release":
  if ! cargo tauri --help >/dev/null 2>&1; then \
    echo "cargo-tauri CLI not found; install it via: cargo install tauri-cli"; \
    exit 1; \
  fi; \
  just web build "{{profile}}"; \
  if [ "{{profile}}" = "release" ]; then \
    (cd crates/luban_tauri && cargo tauri build); \
  elif [ "{{profile}}" = "debug" ] || [ "{{profile}}" = "dev" ]; then \
    (cd crates/luban_tauri && cargo tauri build --debug); \
  else \
    echo "usage: just package [release]"; \
    exit 2; \
  fi
