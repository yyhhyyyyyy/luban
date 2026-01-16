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

export function useActivityTiming(activities: ActivityEvent[]): {
  durationLabel: (event: ActivityEvent) => string | null
} {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const now = Date.now()
    for (const event of activities) {
      const existing = globalTiming.get(event.id) ?? null
      if (!existing) {
        globalTiming.set(event.id, {
          startedAtMs: now,
          doneAtMs: event.status === "done" ? now : null,
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
  }, [activities])

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

