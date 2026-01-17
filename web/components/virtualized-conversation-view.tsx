"use client"

import type React from "react"

import { useEffect, useMemo, useRef, useState } from "react"

import type { Message } from "@/lib/conversation-ui"
import { cn } from "@/lib/utils"
import { ConversationMessage } from "@/components/conversation-view"

const ESTIMATED_MESSAGE_HEIGHT_PX = 140
const OVERSCAN_PX = 800

function findStartIndex(offsets: number[], target: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (offsets[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function VirtualizedConversationView({
  messages,
  emptyState,
  className,
  workspaceId,
  listKey,
  scrollElement,
  renderAgentRunningCard,
}: {
  messages: Message[]
  emptyState?: React.ReactNode
  className?: string
  workspaceId?: number
  listKey: string
  scrollElement: HTMLElement | null
  renderAgentRunningCard?: (message: Message) => React.ReactNode
}): React.ReactElement | null {
  const sizesRef = useRef<Map<string, number>>(new Map())
  const [sizesVersion, setSizesVersion] = useState(0)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 })
  const pendingScrollRef = useRef<number | null>(null)

  useEffect(() => {
    sizesRef.current = new Map()
    setSizesVersion((v) => v + 1)
    setViewport((prev) => ({ ...prev, scrollTop: 0 }))
  }, [listKey])

  useEffect(() => {
    const el = scrollElement
    if (!el) return

    const update = () => {
      pendingScrollRef.current = null
      setViewport({ scrollTop: el.scrollTop, height: el.clientHeight })
    }

    const onScroll = () => {
      if (pendingScrollRef.current != null) return
      pendingScrollRef.current = window.requestAnimationFrame(update)
    }

    const resizeObserver = new ResizeObserver(() => update())
    resizeObserver.observe(el)

    update()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      if (pendingScrollRef.current != null) {
        window.cancelAnimationFrame(pendingScrollRef.current)
        pendingScrollRef.current = null
      }
      resizeObserver.disconnect()
      el.removeEventListener("scroll", onScroll)
    }
  }, [scrollElement])

  const layout = useMemo(() => {
    void sizesVersion
    const offsets: number[] = new Array(messages.length + 1)
    offsets[0] = 0
    for (let i = 0; i < messages.length; i += 1) {
      const key = messages[i]?.id ?? String(i)
      const size = sizesRef.current.get(key) ?? ESTIMATED_MESSAGE_HEIGHT_PX
      offsets[i + 1] = offsets[i]! + size
    }

    const totalHeight = offsets[messages.length] ?? 0
    return { offsets, totalHeight }
  }, [messages, sizesVersion])

  const range = useMemo(() => {
    if (messages.length === 0) return { start: 0, end: 0 }
    const startPx = Math.max(0, viewport.scrollTop - OVERSCAN_PX)
    const endPx = viewport.scrollTop + viewport.height + OVERSCAN_PX

    const start = clamp(findStartIndex(layout.offsets, startPx) - 1, 0, messages.length)
    const end = clamp(findStartIndex(layout.offsets, endPx) + 1, start, messages.length)
    return { start, end }
  }, [layout.offsets, messages.length, viewport.height, viewport.scrollTop])

  if (messages.length === 0) {
    return emptyState ? <>{emptyState}</> : null
  }

  return (
    <div className={cn(className)}>
      <div className="relative" style={{ height: layout.totalHeight }}>
        {messages.slice(range.start, range.end).map((message, idx) => {
          const i = range.start + idx
          const key = message.id
          const top = layout.offsets[i] ?? 0
          return (
            <div
              key={key}
              className="absolute left-0 right-0 pb-4"
              style={{ transform: `translateY(${top}px)` }}
              ref={(node) => {
                if (!node) return
                const height = node.offsetHeight
                const current = sizesRef.current.get(key)
                if (current === height) return
                sizesRef.current.set(key, height)
                setSizesVersion((v) => v + 1)
              }}
            >
              <ConversationMessage
                message={message}
                workspaceId={workspaceId}
                renderAgentRunningCard={renderAgentRunningCard}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
