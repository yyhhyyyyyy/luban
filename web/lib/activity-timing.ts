"use client"

import { useEffect, useState } from "react"

import type { ActivityEvent } from "@/lib/conversation-ui"

type TimingMeta = {
  startedAtMs: number
  doneAtMs: number | null
  status: ActivityEvent["status"]
}

const globalTiming = new Map<string, TimingMeta>()

function formatStepClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const mm = Math.min(minutes, 99)
  return `${String(mm).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
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

    const existingDoneAtMs = activities
      .map((event) => globalTiming.get(event.id)?.doneAtMs ?? null)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    const cursorStartAtMs =
      turnStartedAtMs != null
        ? Math.max(turnStartedAtMs, existingDoneAtMs.length > 0 ? Math.max(...existingDoneAtMs) : turnStartedAtMs)
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
    return formatStepClock(end - meta.startedAtMs)
  }

  return { durationLabel }
}
