"use client"

import { GLOBAL_ZOOM_KEY } from "./ui-prefs"

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

export function loadGlobalZoom(): number {
  const raw = localStorage.getItem(GLOBAL_ZOOM_KEY)
  if (!raw) return DEFAULT_GLOBAL_ZOOM
  const parsed = Number(raw)
  return clampGlobalZoom(parsed)
}

export function saveGlobalZoom(zoom: number) {
  localStorage.setItem(GLOBAL_ZOOM_KEY, String(clampGlobalZoom(zoom)))
}

export function applyGlobalZoom(zoom: number) {
  const clamped = clampGlobalZoom(zoom)
  const px = 16 * clamped
  document.documentElement.style.fontSize = `${px}px`
}

export function stepGlobalZoom(current: number, dir: -1 | 1): number {
  const next = clampGlobalZoom(current + dir * GLOBAL_ZOOM_STEP)
  return Math.round(next * 100) / 100
}

