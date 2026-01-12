"use client"

import { invoke, isTauri } from "@tauri-apps/api/core"

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("open_external", { url })
      return
    } catch (err) {
      console.warn("open_external invoke failed, falling back to window.open", err)
    }
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (!opened) {
    console.warn("window.open was blocked")
  }
}

