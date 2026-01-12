"use client"

import { useLayoutEffect, useState } from "react"

import {
  applyGlobalZoom,
  DEFAULT_GLOBAL_ZOOM,
  loadGlobalZoom,
  saveGlobalZoom,
  stepGlobalZoom,
} from "@/lib/global-zoom"

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea" || tag === "select") return true
  return target.isContentEditable
}

export function GlobalZoomShortcuts() {
  const [zoom, setZoom] = useState<number>(DEFAULT_GLOBAL_ZOOM)

  useLayoutEffect(() => {
    const initial = loadGlobalZoom()
    setZoom(initial)
    applyGlobalZoom(initial)
  }, [])

  useLayoutEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.defaultPrevented) return

      const key = e.key
      const code = e.code
      const editable = isEditableTarget(e.target)

      const plus = key === "+" || key === "=" || code === "NumpadAdd"
      const minus = key === "-" || key === "_" || code === "NumpadSubtract"
      const reset = key === "0" || code === "Numpad0"

      if (!plus && !minus && !reset) return

      e.preventDefault()

      setZoom((current) => {
        const next = reset ? DEFAULT_GLOBAL_ZOOM : stepGlobalZoom(current, plus ? 1 : -1)
        saveGlobalZoom(next)
        applyGlobalZoom(next)
        return next
      })

      if (editable) {
        // keep the behavior consistent even when focused in an input.
        // no-op: we intentionally zoom globally.
      }
    }

    window.addEventListener("keydown", handler, { capture: true })
    return () => window.removeEventListener("keydown", handler, { capture: true } as AddEventListenerOptions)
  }, [])

  return null
}

