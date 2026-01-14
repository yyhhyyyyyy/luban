"use client"

import type { ThinkingEffort } from "@/lib/luban-api"

import { useMemo, useState } from "react"
import { ChevronDown, Settings } from "lucide-react"

import { cn } from "@/lib/utils"
import { AGENT_MODELS, supportedThinkingEffortsForModel } from "@/lib/agent-settings"
import { agentModelLabel, thinkingEffortLabel } from "@/lib/conversation-ui"

function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

export function CodexAgentSelector({
  modelId,
  thinkingEffort,
  onChangeModelId,
  onChangeThinkingEffort,
  defaultModelId,
  defaultThinkingEffort,
  onOpenAgentSettings,
  disabled = false,
  dropdownPosition = "bottom",
  className,
}: {
  modelId: string | null | undefined
  thinkingEffort: ThinkingEffort | null | undefined
  onChangeModelId: (modelId: string) => void
  onChangeThinkingEffort: (effort: ThinkingEffort) => void
  defaultModelId?: string | null
  defaultThinkingEffort?: ThinkingEffort | null
  onOpenAgentSettings?: (agentId: string, filePath?: string) => void
  disabled?: boolean
  dropdownPosition?: "top" | "bottom"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [tempModelId, setTempModelId] = useState<string | null>(null)

  const currentModelId = modelId ?? ""
  const currentEffort = thinkingEffort ?? null

  const displayName = useMemo(() => {
    const model = agentModelLabel(modelId)
    const effort = thinkingEffortLabel(thinkingEffort)
    if (model === "Model" || effort === "Effort") return "Codex"
    return `${model} · ${effort}`
  }, [modelId, thinkingEffort])

  const panelModelId = tempModelId ?? currentModelId
  const effortOptions = useMemo(() => supportedThinkingEffortsForModel(panelModelId), [panelModelId])

  const close = () => {
    setOpen(false)
    setTempModelId(null)
  }

  const apply = (nextModelId: string, nextEffort: ThinkingEffort) => {
    if (nextModelId && nextModelId !== currentModelId) onChangeModelId(nextModelId)
    if (nextEffort !== currentEffort && nextEffort != null) onChangeThinkingEffort(nextEffort)
    close()
  }

  return (
    <div className={cn("relative", className)}>
      <button
        data-testid="codex-agent-selector"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (disabled) return
          setOpen((prev) => !prev)
          setTempModelId(null)
        }}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          open && "bg-muted text-foreground",
          disabled && "opacity-60 cursor-default hover:bg-transparent hover:text-muted-foreground",
        )}
      >
        <OpenAIIcon className="w-3.5 h-3.5" />
        <span className="whitespace-nowrap">{displayName}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => close()} />
          <div
            className={cn(
              "absolute left-0 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden",
              dropdownPosition === "top" ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            <div className="flex divide-x divide-border">
              <div className="p-1">
                <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Agent
                </div>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap bg-primary/10 text-primary"
                >
                  <OpenAIIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  Codex
                </button>
              </div>

              <div className="p-1">
                <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Model
                </div>
                {AGENT_MODELS.map((m) => {
                  const selected = m.id === panelModelId || (panelModelId === "" && m.id === currentModelId)
                  const isDefault = defaultModelId != null && m.id === defaultModelId
                  return (
                    <div key={m.id} className="relative group">
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setTempModelId(m.id)}
                        className={cn(
                          "w-full flex items-center px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap",
                          selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                        )}
                      >
                        <span className="pr-10">{m.label}</span>
                      </button>
                      {isDefault && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity bg-popover/95 rounded">
                          <span className="text-[10px] text-muted-foreground pointer-events-none select-none">
                            default
                          </span>
                          {onOpenAgentSettings && (
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation()
                                close()
                                onOpenAgentSettings("codex", "config.toml")
                              }}
                              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              title="Edit Codex defaults"
                            >
                              <Settings className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="p-1">
                <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Reasoning
                </div>
                {effortOptions.map((effort) => {
                  const selected = effort === (currentEffort ?? "")
                  const isDefault = defaultThinkingEffort != null && effort === defaultThinkingEffort
                  return (
                    <div key={effort} className="relative group">
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => apply(panelModelId, effort)}
                        className={cn(
                          "w-full flex items-center px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap",
                          selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                        )}
                      >
                        <span className="pr-10">{thinkingEffortLabel(effort)}</span>
                      </button>
                      {isDefault && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity bg-popover/95 rounded">
                          <span className="text-[10px] text-muted-foreground pointer-events-none select-none">
                            default
                          </span>
                          {onOpenAgentSettings && (
                            <button
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation()
                                close()
                                onOpenAgentSettings("codex", "config.toml")
                              }}
                              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              title="Edit Codex defaults"
                            >
                              <Settings className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
