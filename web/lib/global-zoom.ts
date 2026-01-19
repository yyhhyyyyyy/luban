"use client"

import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"

export const DEFAULT_GLOBAL_ZOOM = 1
export const GLOBAL_ZOOM_STEP = 0.1
export const GLOBAL_ZOOM_MIN = 0.7
export const GLOBAL_ZOOM_MAX = 1.6

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function clampGlobalZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_GLOBAL_ZOOM
  return clamp(zoom, GLOBAL_ZOOM_MIN, GLOBAL_ZOOM_MAX)
}

export function applyGlobalZoom(zoom: number) {
  const clamped = clampGlobalZoom(zoom)
  if (!isTauri()) return
  void getCurrentWebview()
    .setZoom(clamped)
    .catch((err: unknown) => console.warn("setZoom failed", err))
}

export function stepGlobalZoom(current: number, dir: -1 | 1): number {
  const next = clampGlobalZoom(current + dir * GLOBAL_ZOOM_STEP)
  return Math.round(next * 100) / 100
}
