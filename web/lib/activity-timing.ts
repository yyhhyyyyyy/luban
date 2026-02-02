"use client"

import { useEffect, useState } from "react"

import type { ActivityEvent } from "@/lib/conversation-ui"

type TimingMeta = {
  startedAtMs: number
  doneAtMs: number | null
  status: ActivityEvent["status"]
}

const globalTiming = new Map<string, TimingMeta>()
const MAX_TIMING_ENTRIES = 50_000
const PRUNE_BATCH_SIZE = 5_000

function formatStepDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutesTotal = Math.floor(totalSeconds / 60)
  const hours = Math.floor(minutesTotal / 60)
  const minutes = minutesTotal % 60

  if (totalSeconds < 60) return "now"
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutesTotal}m`
}

export function useActivityTiming(
  activities: ActivityEvent[],
  opts?: { turnStartedAtMs?: number | null },
): {
  durationLabel: (event: ActivityEvent) => string | null
} {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const now = Date.now()
    const turnStartedAtMs =
      typeof opts?.turnStartedAtMs === "number" && Number.isFinite(opts.turnStartedAtMs)
        ? opts.turnStartedAtMs
        : null

    let maxExistingDoneAtMs: number | null = null
    for (const event of activities) {
      const doneAtMs = globalTiming.get(event.id)?.doneAtMs ?? null
      if (typeof doneAtMs !== "number" || !Number.isFinite(doneAtMs)) continue
      if (maxExistingDoneAtMs == null || doneAtMs > maxExistingDoneAtMs) {
        maxExistingDoneAtMs = doneAtMs
      }
    }
    const cursorStartAtMs =
      turnStartedAtMs != null
        ? Math.max(turnStartedAtMs, maxExistingDoneAtMs ?? turnStartedAtMs)
        : null

    const newDone = activities.filter((event) => !globalTiming.has(event.id) && event.status === "done")
    const planned = new Map<string, { startedAtMs: number; doneAtMs: number }>()
    if (cursorStartAtMs != null && newDone.length > 0) {
      const spanMs = Math.max(0, now - cursorStartAtMs)
      const chunk = Math.max(1, Math.floor(spanMs / newDone.length))
      let cursor = cursorStartAtMs
      for (let i = 0; i < newDone.length; i += 1) {
        const event = newDone[i]
        if (!event) continue
        const doneAtMs = i === newDone.length - 1 ? now : Math.min(now, cursor + chunk)
        planned.set(event.id, { startedAtMs: cursor, doneAtMs })
        cursor = doneAtMs
      }
    }

    for (const event of activities) {
      const existing = globalTiming.get(event.id) ?? null
      if (!existing) {
        const plannedTimes = planned.get(event.id) ?? null
        globalTiming.set(event.id, {
          startedAtMs: plannedTimes?.startedAtMs ?? now,
          doneAtMs:
            event.status === "done"
              ? plannedTimes?.doneAtMs ?? now
              : null,
          status: event.status,
        })
        continue
      }

      if (existing.status !== event.status) {
        existing.status = event.status
        if (event.status === "done" && existing.doneAtMs == null) {
          existing.doneAtMs = now
        }
      }
    }

    if (globalTiming.size > MAX_TIMING_ENTRIES) {
      let pruned = 0
      for (const key of globalTiming.keys()) {
        globalTiming.delete(key)
        pruned += 1
        if (pruned >= PRUNE_BATCH_SIZE || globalTiming.size <= MAX_TIMING_ENTRIES) break
      }
    }
  }, [activities, opts?.turnStartedAtMs])

  const hasRunningSteps = activities.some((e) => e.status === "running")
  useEffect(() => {
    if (!hasRunningSteps) return
    const timer = window.setInterval(() => setTick((n) => (n + 1) % 1_000_000), 250)
    return () => window.clearInterval(timer)
  }, [hasRunningSteps])

  const durationLabel = (event: ActivityEvent): string | null => {
    void tick
    const meta = globalTiming.get(event.id) ?? null
    if (!meta) return null
    const end = meta.doneAtMs ?? Date.now()
    return formatStepDuration(end - meta.startedAtMs)
  }

  return { durationLabel }
}
