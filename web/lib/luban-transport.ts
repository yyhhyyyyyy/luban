"use client"

import { useEffect, useRef, useState } from "react"

import type { ClientAction, ServerEvent, WsClientMessage, WsServerMessage } from "./luban-api"

const PROTOCOL_VERSION = 1

function randomRequestId(): string {
  return `req_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

function wsUrl(path: string): string {
  const url = new URL(path, window.location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

type PendingResponse = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export function useLubanTransport(args: {
  onEvent: (event: ServerEvent) => void
  onError: (message: string) => void
}): {
  wsConnected: boolean
  sendAction: (action: ClientAction, requestId?: string) => void
  request: <T>(action: ClientAction) => Promise<T>
} {
  const [wsConnected, setWsConnected] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const pendingActionsRef = useRef<ClientAction[]>([])
  const pendingResponsesRef = useRef<Map<string, PendingResponse>>(new Map())
  const handlersRef = useRef({ onEvent: args.onEvent, onError: args.onError })

  useEffect(() => {
    handlersRef.current = { onEvent: args.onEvent, onError: args.onError }
  }, [args.onEvent, args.onError])

  function sendAction(action: ClientAction, requestId?: string) {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const queue = pendingActionsRef.current
      if (queue.length < 128) {
        queue.push(action)
      } else {
        queue.shift()
        queue.push(action)
      }
      return
    }
    const msg: WsClientMessage = { type: "action", request_id: requestId ?? randomRequestId(), action }
    ws.send(JSON.stringify(msg))
  }

  function request<T>(action: ClientAction): Promise<T> {
    const requestId = randomRequestId()
    return new Promise<T>((resolve, reject) => {
      pendingResponsesRef.current.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      sendAction(action, requestId)
    })
  }

  useEffect(() => {
    const ws = new WebSocket(wsUrl("/api/events"))
    wsRef.current = ws

    ws.onopen = () => {
      const hello: WsClientMessage = {
        type: "hello",
        protocol_version: PROTOCOL_VERSION,
        last_seen_rev: null,
      }
      ws.send(JSON.stringify(hello))
      setWsConnected(true)

      const pending = pendingActionsRef.current.splice(0, pendingActionsRef.current.length)
      for (const action of pending) {
        const msg: WsClientMessage = { type: "action", request_id: randomRequestId(), action }
        ws.send(JSON.stringify(msg))
      }
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return

      let msg: WsServerMessage
      try {
        msg = JSON.parse(ev.data) as WsServerMessage
      } catch {
        handlersRef.current.onError("Invalid server message")
        return
      }

      if (msg.type === "event") {
        const event = msg.event

        if (
          event.type === "project_path_picked" ||
          event.type === "task_preview_ready" ||
          event.type === "task_executed"
        ) {
          const pending = pendingResponsesRef.current.get(event.request_id)
          if (pending) {
            pendingResponsesRef.current.delete(event.request_id)
            if (event.type === "project_path_picked") pending.resolve(event.path)
            if (event.type === "task_preview_ready") pending.resolve(event.draft)
            if (event.type === "task_executed") pending.resolve(event.result)
          }
          return
        }

        handlersRef.current.onEvent(event)
        return
      }

      if (msg.type === "error") {
        if (msg.request_id) {
          const pending = pendingResponsesRef.current.get(msg.request_id)
          if (pending) {
            pendingResponsesRef.current.delete(msg.request_id)
            pending.reject(new Error(msg.message))
            return
          }
        }
        handlersRef.current.onError(msg.message)
      }
    }

    ws.onerror = () => setWsConnected(false)
    ws.onclose = () => setWsConnected(false)

    return () => ws.close()
  }, [])

  return { wsConnected, sendAction, request }
}

