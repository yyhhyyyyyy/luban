"use client"

import { useEffect, useRef } from "react"
import { FitAddon, Terminal } from "ghostty-web"
import type { ITheme } from "ghostty-web"
import { useTheme } from "next-themes"

import { useLuban } from "@/lib/luban-context"
import { useAppearance } from "@/components/appearance-provider"

function escapeCssFontName(value: string): string {
  return value.replaceAll('"', '\\"')
}

function terminalFontFamily(fontName: string): string {
  const escaped = escapeCssFontName(fontName.trim() || "Geist Mono")
  return `"${escaped}", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace`
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const el = document.createElement("textarea")
    el.value = text
    el.style.position = "fixed"
    el.style.left = "-9999px"
    el.style.top = "-9999px"
    document.body.appendChild(el)
    el.focus()
    el.select()
    el.setSelectionRange(0, text.length)
    document.execCommand("copy")
    document.body.removeChild(el)
  }
}

function cssVar(name: string): string | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw.length > 0 ? raw : null
}

function normalizeHexColor(raw: string): string | null {
  const hex = raw.trim()
  if (!hex.startsWith("#")) return null
  const h = hex.slice(1)
  if (h.length === 3) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  }
  if (h.length === 6) return `#${h}`
  return null
}

function parseRgbColor(raw: string): { r: number; g: number; b: number } | null {
  const trimmed = raw.trim()
  const m = /^rgb\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$/.exec(trimmed)
  if (!m) return null
  const r = Number.parseInt(m[1], 10)
  const g = Number.parseInt(m[2], 10)
  const b = Number.parseInt(m[3], 10)
  if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return null
  return { r, g, b }
}

function toHexColor(raw: string): string | null {
  const hex = normalizeHexColor(raw)
  if (hex) return hex
  const rgb = parseRgbColor(raw)
  if (!rgb) return null
  const to2 = (v: number) => v.toString(16).padStart(2, "0")
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`
}

function hexToRgba(hex: string, alpha: number): string | null {
  const raw = hex.trim()
  if (!raw.startsWith("#")) return null
  const h = raw.slice(1)
  const normalized =
    h.length === 3
      ? `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
      : h.length === 6
        ? h
        : null
  if (!normalized) return null
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function terminalThemeFromCss(): ITheme {
  const background = cssVar("--card") ?? "#ffffff"
  const foreground = cssVar("--card-foreground") ?? "#333333"
  const cursor = cssVar("--foreground") ?? foreground
  const primary = cssVar("--primary") ?? "#3b82f6"
  const mutedForeground = cssVar("--muted-foreground") ?? "#6b7280"
  const selectionBackground = hexToRgba(toHexColor(primary) ?? primary, 0.25) ?? "rgba(59, 130, 246, 0.25)"
  return {
    background,
    foreground,
    cursor,
    selectionBackground,
    black: background,
    brightBlack: mutedForeground,
    white: foreground,
    brightWhite: foreground,
  }
}

function writeOscTheme(term: Terminal) {
  const background = toHexColor(cssVar("--card") ?? "#ffffff") ?? "#ffffff"
  const foreground = toHexColor(cssVar("--card-foreground") ?? "#333333") ?? "#333333"
  const cursor = toHexColor(cssVar("--foreground") ?? foreground) ?? foreground

  // ghostty-web renders fg/bg from the emulator's resolved RGB values.
  // Emit OSC sequences to update defaults in the emulator itself.
  const osc =
    `\x1b]10;${foreground}\x07` + // default foreground
    `\x1b]11;${background}\x07` + // default background
    `\x1b]12;${cursor}\x07` // cursor
  term.write(osc)
}

function isValidTerminalSize(cols: number, rows: number): boolean {
  return Number.isFinite(cols) && Number.isFinite(rows) && cols >= 2 && rows >= 2
}

export function PtyTerminal() {
  const { activeWorkspaceId } = useLuban()
  const { fonts } = useAppearance()
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastThemeDigestRef = useRef<string | null>(null)

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const renderer = (term as any).renderer as { setFontFamily?: (family: string) => void } | undefined
    renderer?.setFontFamily?.(terminalFontFamily(fonts.terminalFont))
    fitAddonRef.current?.fit()
  }, [fonts.terminalFont])

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    let cancelled = false
    window.requestAnimationFrame(() => {
      if (cancelled) return

      const theme = terminalThemeFromCss()
      const digest = JSON.stringify(theme)
      if (lastThemeDigestRef.current === digest) return
      lastThemeDigestRef.current = digest

      const renderer = (term as any).renderer as { setTheme?: (theme: ITheme) => void } | undefined
      renderer?.setTheme?.(theme)
      writeOscTheme(term)
    })

    return () => {
      cancelled = true
    }
  }, [resolvedTheme])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (activeWorkspaceId == null) {
      container.textContent = "Select a workspace to start a terminal."
      return
    }

    container.innerHTML = ""

    const ptyThreadId = 1

    let disposed = false
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    const term = new Terminal({
      fontFamily: terminalFontFamily(fonts.terminalFont),
      fontSize: 12,
      wasmPath: "/ghostty-vt.wasm",
      cursorBlink: true,
      theme: terminalThemeFromCss(),
    })
    termRef.current = term

    term.loadAddon(fitAddon)

    const decoder = new TextDecoder("utf-8")
    let ws: WebSocket | null = null
    let dataDisposable: { dispose: () => void } | null = null
    let resizeDisposable: { dispose: () => void } | null = null
    let keydownCapture: ((ev: KeyboardEvent) => void) | null = null
    let pasteCapture: ((ev: ClipboardEvent) => void) | null = null
    let focusCapture: (() => void) | null = null
    let pendingPastePromise: Promise<string> | null = null
    let pasteHandled = false

    function sendInput(text: string) {
      if (ws?.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: "input", data: text }))
    }

    function sendResizeIfReady(cols: number, rows: number) {
      if (!isValidTerminalSize(cols, rows)) return
      if (ws?.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: "resize", cols, rows }))
    }

    function scheduleFitAndResizeSync() {
      let attempts = 0
      const maxAttempts = 20
      const tick = () => {
        if (disposed) return
        try {
          fitAddon.fit()
        } catch {
          // ignore
        }
        sendResizeIfReady(term.cols, term.rows)
        attempts += 1
        if (!isValidTerminalSize(term.cols, term.rows) && attempts < maxAttempts) {
          window.setTimeout(tick, 50)
        }
      }
      window.requestAnimationFrame(tick)
    }

    void term
      .open(container)
      .then(() => {
        if (disposed) return

        writeOscTheme(term)

        focusCapture = () => {
          try {
            container.focus({ preventScroll: true })
            term.focus()
          } catch {
            // ignore
          }
        }

        keydownCapture = (ev: KeyboardEvent) => {
          const isShortcut = ev.ctrlKey || ev.metaKey
          if (!isShortcut) return

          if (ev.code === "KeyC") {
            if (!term.hasSelection()) return

            const selection = term.getSelection()
            if (selection.trim().length === 0) return

            ev.preventDefault()
            ev.stopPropagation()
            ev.stopImmediatePropagation()

            void copyToClipboard(selection)
            return
          }

          if (ev.code === "KeyV") {
            pasteHandled = false
            const promise = navigator.clipboard?.readText ? navigator.clipboard.readText() : null
            pendingPastePromise = promise

            if (!promise) return

            queueMicrotask(() => {
              if (disposed) return
              if (pasteHandled) return

              void promise
                .then((text) => {
                  if (disposed) return
                  if (pasteHandled) return
                  if (text.length === 0) return
                  sendInput(text)
                })
                .catch(() => {
                  // Ignore clipboard errors (permissions, etc.).
                })
                .finally(() => {
                  if (pendingPastePromise === promise) pendingPastePromise = null
                })
            })
            return
          }
        }

        pasteCapture = () => {
          pasteHandled = true
        }

        container.addEventListener("mousedown", focusCapture, true)
        container.addEventListener("touchstart", focusCapture, true)
        container.addEventListener("keydown", keydownCapture, true)
        container.addEventListener("paste", pasteCapture, true)

        resizeDisposable = term.onResize(({ cols, rows }) => {
          sendResizeIfReady(cols, rows)
        })

        scheduleFitAndResizeSync()
        fitAddon.observeResize()

        const url = new URL(`/api/pty/${activeWorkspaceId}/${ptyThreadId}`, window.location.href)
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
        ws = new WebSocket(url.toString())
        ws.binaryType = "arraybuffer"

        ws.onmessage = (ev) => {
          if (disposed) return
          if (typeof ev.data === "string") return
          const bytes = new Uint8Array(ev.data as ArrayBuffer)
          term.write(decoder.decode(bytes))
        }

        ws.onopen = () => {
          if (disposed) return
          scheduleFitAndResizeSync()
        }

        dataDisposable = term.onData((data: string) => {
          if (ws?.readyState !== WebSocket.OPEN) return
          ws.send(JSON.stringify({ type: "input", data }))
        })
      })
      .catch((err) => {
        if (disposed) return
        container.textContent = `Terminal init failed: ${String(err)}`
      })

    return () => {
      disposed = true
      termRef.current = null
      fitAddonRef.current = null
      if (focusCapture) container.removeEventListener("mousedown", focusCapture, true)
      if (focusCapture) container.removeEventListener("touchstart", focusCapture, true)
      if (keydownCapture) container.removeEventListener("keydown", keydownCapture, true)
      if (pasteCapture) container.removeEventListener("paste", pasteCapture, true)
      dataDisposable?.dispose()
      resizeDisposable?.dispose()
      ws?.close()
      term.dispose()
    }
  }, [activeWorkspaceId])

  return (
    <div
      ref={containerRef}
      data-testid="pty-terminal"
      tabIndex={0}
      className="h-full w-full p-3 font-mono text-xs overflow-auto bg-card text-card-foreground focus:outline-none"
    />
  )
}
