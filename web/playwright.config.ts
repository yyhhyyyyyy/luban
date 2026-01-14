import { defineConfig } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function resolveE2ERoot(): string {
  const existing = process.env.LUBAN_E2E_ROOT
  if (existing && existing.trim()) return existing
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luban-e2e-"))
  process.env.LUBAN_E2E_ROOT = root
  return root
}

function resolvePort(): number {
  const raw = process.env.LUBAN_E2E_PORT
  if (raw && raw.trim()) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) return parsed
    throw new Error(`invalid LUBAN_E2E_PORT: ${raw}`)
  }

  const out = execFileSync(process.execPath, [
    "-e",
    [
      'const net = require("node:net");',
      "const server = net.createServer();",
      'server.listen(0, "127.0.0.1", () => {',
      "  const addr = server.address();",
      "  if (!addr || typeof addr === 'string') process.exit(2);",
      "  console.log(String(addr.port));",
      "  server.close();",
      "});",
    ].join(""),
  ])
    .toString("utf8")
    .trim()
  const parsed = Number(out)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 65536) {
    throw new Error(`failed to allocate a free port: ${out}`)
  }
  process.env.LUBAN_E2E_PORT = String(parsed)
  return parsed
}

const e2eRoot = resolveE2ERoot()
const port = resolvePort()
const baseURL = `http://127.0.0.1:${port}`
const e2eLubanRoot = path.join(e2eRoot, "luban-root")
fs.mkdirSync(e2eLubanRoot, { recursive: true })
const e2eCodexRoot = path.join(e2eRoot, "codex-root")
fs.mkdirSync(e2eCodexRoot, { recursive: true })
fs.writeFileSync(
  path.join(e2eCodexRoot, "config.toml"),
  ['model = "gpt-5.2-codex"', 'model_reasoning_effort = "high"', ""].join("\n"),
  "utf8",
)

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: (() => {
    const raw = process.env.LUBAN_E2E_WORKERS
    if (raw && raw.trim()) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
      throw new Error(`invalid LUBAN_E2E_WORKERS: ${raw}`)
    }
    // The luban server is shared across workers via `webServer`, so parallel UI tests
    // share a DB and mutate global state. Default to a single worker for determinism.
    return 1
  })(),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command:
      "cd .. && " +
      "RUSTUP_HOME=${RUSTUP_HOME:-$HOME/.rustup} " +
      "CARGO_HOME=${CARGO_HOME:-$HOME/.cargo} " +
      `LUBAN_E2E_ROOT=${shellQuote(e2eRoot)} ` +
      `LUBAN_ROOT=${shellQuote(e2eLubanRoot)} ` +
      `LUBAN_CODEX_ROOT=${shellQuote(e2eCodexRoot)} ` +
      "LUBAN_WEB_DIST_DIR=web/out " +
      `LUBAN_SERVER_ADDR=127.0.0.1:${port} ` +
      "LUBAN_CODEX_BIN=/usr/bin/false " +
      "just run",
    url: `${baseURL}/api/health`,
    reuseExistingServer: process.env.LUBAN_E2E_REUSE_SERVER === "1",
    timeout: 180_000,
  },
})
