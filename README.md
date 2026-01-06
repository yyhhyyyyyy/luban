# Luban

Luban is a standalone AI code editor app built with GPUI, with a Zed-like layout:

- Left: sidebar
- Center: timeline
- Right: diff / terminal

## Development

This project uses `just` to manage all common dev commands.

The embedded terminal requires Zig (0.14.1) for building `ghostty_vt_sys`.

Install Zig using a toolchain manager (recommended: `zvm`) or your system package manager, and ensure `zig` is available in `PATH` (or set `ZIG=/path/to/zig`).

```bash
just -l
```

### macOS Requirements

GPUI uses Metal shaders on macOS. Ensure the Metal toolchain component is installed:

```bash
xcodebuild -downloadComponent MetalToolchain
```

### Run

```bash
just run
```

### Codex CLI

The Agent chat panel streams events from the Codex CLI.

Install Codex CLI and ensure `codex` is available in `PATH`.

Optionally, set `LUBAN_CODEX_BIN` to override the executable path.

### Build

```bash
just build
```
