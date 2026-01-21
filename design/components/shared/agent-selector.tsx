"use client"

import { useState, useEffect } from "react"
import { ChevronDown, Zap, Code2, RotateCcw, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

// ============ Agent 品牌图标 (官方 Logo) ============

// Anthropic Claude Logo
function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M16.091 5.624 9.392 19h-2.72l6.7-13.376h2.719ZM8.727 5.624 2.028 19H5.08l5.122-10.066L8.727 5.624Zm6.364 0 1.476 3.31L21.69 19h-3.052l-3.546-13.376Z" />
    </svg>
  )
}

// OpenAI Logo (用于 Codex)
function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

// Google Gemini Logo
function GeminiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C9.284 5.352 5.352 9.284 0 12c5.352 2.716 9.284 6.648 12 12 2.716-5.352 6.648-9.284 12-12-5.352-2.716-9.284-6.648-12-12z" />
    </svg>
  )
}

// Agent ID 到图标的映射
export function AgentIcon({ agentId, className }: { agentId: string; className?: string }) {
  switch (agentId) {
    case "claude-code":
      return <ClaudeIcon className={className} />
    case "codex":
      return <OpenAIIcon className={className} />
    case "gemini-cli":
      return <GeminiIcon className={className} />
    case "amp":
      return <Zap className={className} />
    case "opencode":
      return <Code2 className={className} />
    default:
      return null
  }
}

// ============ 类型定义 ============

export interface SelectOption {
  id: string
  label: string
}

export interface ConfigColumn {
  id: string
  label: string
  options: SelectOption[]
  defaultValue: string
  dependsOn?: string
  optionsByDependency?: Record<string, SelectOption[]>
  defaultByDependency?: Record<string, string>
}

export interface AgentConfig {
  id: string
  name: string
  columns: ConfigColumn[]
}

// ============ Agent 配置数据 ============

export const agentConfigs: AgentConfig[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    columns: [
      {
        id: "model",
        label: "Model",
        options: [
          { id: "claude-4-opus", label: "Claude 4 Opus" },
          { id: "claude-4-sonnet", label: "Claude 4 Sonnet" },
        ],
        defaultValue: "claude-4-sonnet",
      },
      {
        id: "reasoning",
        label: "Reasoning",
        options: [
          { id: "standard", label: "Standard" },
          { id: "extended", label: "Extended Thinking" },
        ],
        defaultValue: "standard",
      },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    columns: [
      {
        id: "model",
        label: "Model",
        options: [{ id: "codex-1", label: "codex-1" }],
        defaultValue: "codex-1",
      },
      {
        id: "reasoning",
        label: "Reasoning",
        options: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
        ],
        defaultValue: "medium",
      },
    ],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    columns: [
      {
        id: "model",
        label: "Model",
        options: [
          { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        ],
        defaultValue: "gemini-2.5-pro",
      },
      {
        id: "thinking",
        label: "Thinking",
        options: [
          { id: "off", label: "Off" },
          { id: "on", label: "On" },
        ],
        defaultValue: "on",
      },
    ],
  },
  {
    id: "amp",
    name: "Amp",
    columns: [
      {
        id: "mode",
        label: "Mode",
        options: [
          { id: "smart", label: "Smart" },
          { id: "free", label: "Free" },
        ],
        defaultValue: "smart",
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    columns: [
      {
        id: "model",
        label: "Model",
        options: [
          { id: "claude-4-opus", label: "Claude 4 Opus" },
          { id: "claude-4-sonnet", label: "Claude 4 Sonnet" },
          { id: "gpt-4.1", label: "GPT-4.1" },
          { id: "o3", label: "o3" },
          { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        ],
        defaultValue: "claude-4-sonnet",
      },
      {
        id: "reasoning",
        label: "Reasoning",
        options: [],
        defaultValue: "standard",
        dependsOn: "model",
        optionsByDependency: {
          "claude-4-opus": [
            { id: "standard", label: "Standard" },
            { id: "extended", label: "Extended Thinking" },
          ],
          "claude-4-sonnet": [
            { id: "standard", label: "Standard" },
            { id: "extended", label: "Extended Thinking" },
          ],
          "gpt-4.1": [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
          "o3": [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
          "gemini-2.5-pro": [
            { id: "off", label: "Off" },
            { id: "on", label: "On" },
          ],
        },
        defaultByDependency: {
          "claude-4-opus": "extended",
          "claude-4-sonnet": "standard",
          "gpt-4.1": "medium",
          "o3": "high",
          "gemini-2.5-pro": "on",
        },
      },
    ],
  },
]

// ============ Default Config Store (模拟持久化配置) ============

export interface AgentDefaultConfig {
  agentId: string
  defaults: Record<string, string>  // columnId -> default value
}

// 全局默认配置状态 (实际项目中应该用 Context 或状态管理库)
// 包含所有列的默认值，与 agentConfigs 中的 defaultValue 保持一致
let globalDefaultConfigs: Record<string, Record<string, string>> = {
  "claude-code": { model: "claude-4-sonnet", reasoning: "standard" },
  "codex": { model: "codex-1", reasoning: "medium" },
  "gemini-cli": { model: "gemini-2.5-pro", thinking: "on" },
  "amp": { mode: "smart" },
  "opencode": { model: "claude-4-sonnet", reasoning: "standard" },
}

let globalDefaultConfigListeners: Set<() => void> = new Set()

export function getDefaultConfig(agentId: string): Record<string, string> {
  return globalDefaultConfigs[agentId] ?? {}
}

export function setDefaultConfig(agentId: string, columnId: string, value: string) {
  globalDefaultConfigs = {
    ...globalDefaultConfigs,
    [agentId]: {
      ...globalDefaultConfigs[agentId],
      [columnId]: value,
    },
  }
  globalDefaultConfigListeners.forEach((listener) => listener())
}

export function subscribeToDefaultConfig(listener: () => void): () => void {
  globalDefaultConfigListeners.add(listener)
  return () => globalDefaultConfigListeners.delete(listener)
}

// ============ Helper functions ============

export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return agentConfigs.find((a) => a.id === agentId)
}

export function getColumnOptions(column: ConfigColumn, selections: Record<string, string>): SelectOption[] {
  if (column.dependsOn && column.optionsByDependency) {
    const dependencyValue = selections[column.dependsOn]
    return column.optionsByDependency[dependencyValue] ?? []
  }
  return column.options
}

export function getColumnDefault(column: ConfigColumn, selections: Record<string, string>): string {
  if (column.dependsOn && column.defaultByDependency) {
    const dependencyValue = selections[column.dependsOn]
    return column.defaultByDependency[dependencyValue] ?? column.defaultValue
  }
  return column.defaultValue
}

export function getAgentDefaults(agent: AgentConfig): Record<string, string> {
  const selections: Record<string, string> = {}
  for (const column of agent.columns) {
    selections[column.id] = getColumnDefault(column, selections)
  }
  return selections
}

// ============ Hook for Agent Selection State ============

export interface UseAgentSelectorReturn {
  selectedAgentId: string
  selections: Record<string, string>
  currentAgent: AgentConfig
  displayName: string
  showSelector: boolean
  // Config source tracking
  isUsingConfigDefaults: boolean  // true 如果当前值来自 config 默认值
  overriddenColumns: Set<string>  // 被用户手动覆盖的列
  // Panel state
  panelAgent: AgentConfig
  tempAgentId: string | null
  tempSelections: Record<string, string>
  // Actions
  openSelector: () => void
  closeSelector: () => void
  handleAgentClick: (agentId: string) => void
  handleColumnClick: (columnId: string, value: string, columnIndex: number) => void
  getPanelSelection: (columnId: string) => string
  shouldShowColumn: (columnIndex: number) => boolean
  resetToConfigDefaults: () => void  // 重置为 config 默认值
  isConfigDefault: (columnId: string, value: string) => boolean  // 检查某个值是否为 config 默认值
}

export function useAgentSelector(initialAgentId?: string): UseAgentSelectorReturn {
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId ?? agentConfigs[0].id)
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    getAgentDefaults(getAgentConfig(initialAgentId ?? agentConfigs[0].id) ?? agentConfigs[0])
  )
  const [showSelector, setShowSelector] = useState(false)
  const [tempAgentId, setTempAgentId] = useState<string | null>(null)
  const [tempSelections, setTempSelections] = useState<Record<string, string>>({})
  const [tempModifiedColumns, setTempModifiedColumns] = useState<Set<string>>(new Set())
  
  // 追踪哪些列被用户手动覆盖
  const [overriddenColumns, setOverriddenColumns] = useState<Set<string>>(new Set())
  
  // 订阅配置变化
  const [, forceUpdate] = useState({})
  useEffect(() => {
    return subscribeToDefaultConfig(() => forceUpdate({}))
  }, [])

  const currentAgent = getAgentConfig(selectedAgentId) ?? agentConfigs[0]
  const panelAgent = tempAgentId ? (getAgentConfig(tempAgentId) ?? currentAgent) : currentAgent

  const getPanelSelection = (columnId: string): string => {
    if (tempSelections[columnId] !== undefined) {
      return tempSelections[columnId]
    }
    if (!tempAgentId) {
      return selections[columnId] ?? ""
    }
    const column = panelAgent.columns.find((c) => c.id === columnId)
    return column ? getColumnDefault(column, tempSelections) : ""
  }

  const shouldShowColumn = (columnIndex: number): boolean => {
    if (!tempAgentId && tempModifiedColumns.size === 0) {
      return true
    }
    const columns = panelAgent.columns
    if (columnIndex === 0) return true
    if (tempAgentId) {
      for (let i = 0; i < columnIndex; i++) {
        if (tempSelections[columns[i].id] === undefined) {
          return false
        }
      }
      return true
    }
    for (let i = 0; i < columnIndex; i++) {
      if (tempModifiedColumns.has(columns[i].id) && tempSelections[columns[i + 1]?.id] === undefined) {
        return i + 1 >= columnIndex ? false : true
      }
    }
    return true
  }

  const openSelector = () => {
    setShowSelector(true)
    setTempAgentId(null)
    setTempSelections({})
    setTempModifiedColumns(new Set())
  }

  const closeSelector = () => {
    setShowSelector(false)
    setTempAgentId(null)
    setTempSelections({})
    setTempModifiedColumns(new Set())
  }

  const handleAgentClick = (agentId: string) => {
    if (agentId === selectedAgentId && !tempAgentId) {
      return
    }
    setTempAgentId(agentId)
    setTempSelections({})
    setTempModifiedColumns(new Set())
  }

  const applySelections = (finalTempSelections: Record<string, string>, markAsOverride = true) => {
    const finalAgentId = tempAgentId ?? selectedAgentId
    const finalAgent = getAgentConfig(finalAgentId) ?? currentAgent
    const configDefaults = getDefaultConfig(finalAgentId)
    const newSelections: Record<string, string> = {}
    const newOverrides = new Set<string>()
    
    for (const column of finalAgent.columns) {
      if (finalTempSelections[column.id] !== undefined) {
        newSelections[column.id] = finalTempSelections[column.id]
        // 检查是否与 config 默认值不同
        const configDefault = configDefaults[column.id]
        if (markAsOverride && configDefault && finalTempSelections[column.id] !== configDefault) {
          newOverrides.add(column.id)
        }
      } else if (!tempAgentId && selections[column.id]) {
        newSelections[column.id] = selections[column.id]
        // 保留已有的覆盖状态
        if (overriddenColumns.has(column.id)) {
          newOverrides.add(column.id)
        }
      } else {
        newSelections[column.id] = getColumnDefault(column, newSelections)
      }
    }
    setSelectedAgentId(finalAgentId)
    setSelections(newSelections)
    setOverriddenColumns(newOverrides)
    closeSelector()
  }

  const handleColumnClick = (columnId: string, value: string, columnIndex: number) => {
    const newTempSelections = { ...tempSelections, [columnId]: value }
    const columns = panelAgent.columns
    for (let i = columnIndex + 1; i < columns.length; i++) {
      delete newTempSelections[columns[i].id]
    }
    setTempSelections(newTempSelections)
    if (!tempAgentId) {
      setTempModifiedColumns((prev) => new Set(prev).add(columnId))
    }
    if (columnIndex === columns.length - 1) {
      applySelections(newTempSelections)
    }
  }

  // 重置为 config 默认值
  const resetToConfigDefaults = () => {
    const configDefaults = getDefaultConfig(selectedAgentId)
    const newSelections = { ...selections }
    for (const column of currentAgent.columns) {
      if (configDefaults[column.id]) {
        newSelections[column.id] = configDefaults[column.id]
      }
    }
    setSelections(newSelections)
    setOverriddenColumns(new Set())
  }
  
  // 检查是否所有值都与 config 默认值一致
  const isUsingConfigDefaults = (): boolean => {
    return overriddenColumns.size === 0
  }
  
  // 检查某个值是否为当前 agent 的 config 默认值
  const isConfigDefault = (columnId: string, value: string): boolean => {
    const agentId = tempAgentId ?? selectedAgentId
    const configDefaults = getDefaultConfig(agentId)
    return configDefaults[columnId] === value
  }

  const getDisplayName = (): string => {
    const parts: string[] = []
    for (const column of currentAgent.columns) {
      const value = selections[column.id]
      const option = getColumnOptions(column, selections).find((o) => o.id === value)
      if (option) {
        parts.push(option.label)
      }
    }
    return parts.join(" · ")
  }

  return {
    selectedAgentId,
    selections,
    currentAgent,
    displayName: getDisplayName(),
    showSelector,
    isUsingConfigDefaults: isUsingConfigDefaults(),
    overriddenColumns,
    panelAgent,
    tempAgentId,
    tempSelections,
    openSelector,
    closeSelector,
    handleAgentClick,
    handleColumnClick,
    getPanelSelection,
    shouldShowColumn,
    resetToConfigDefaults,
    isConfigDefault,
  }
}

// ============ Agent Selector Component ============

interface AgentSelectorProps {
  className?: string
  dropdownPosition?: "top" | "bottom"
  onOpenAgentSettings?: (agentId: string) => void  // 点击 settings icon 时的回调
}

export function AgentSelector({ className, dropdownPosition = "bottom", onOpenAgentSettings }: AgentSelectorProps) {
  const {
    selectedAgentId,
    selections,
    displayName,
    showSelector,
    isUsingConfigDefaults,
    overriddenColumns,
    panelAgent,
    tempAgentId,
    tempSelections,
    openSelector,
    closeSelector,
    handleAgentClick,
    handleColumnClick,
    getPanelSelection,
    shouldShowColumn,
    resetToConfigDefaults,
    isConfigDefault,
  } = useAgentSelector()

  return (
    <div className={cn("relative", className)}>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={openSelector}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          showSelector && "bg-muted text-foreground"
        )}
      >
        <AgentIcon agentId={selectedAgentId} className="w-3.5 h-3.5" />
        <span className="whitespace-nowrap">{displayName}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", showSelector && "rotate-180")} />
      </button>

      {showSelector && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeSelector} />
          <div
            className={cn(
              "absolute left-0 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden",
              dropdownPosition === "top" ? "bottom-full mb-1" : "top-full mt-1"
            )}
          >
            <div className="flex divide-x divide-border">
              {/* Agent Column */}
              <div className="p-1">
                <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Agent
                </div>
                {agentConfigs.map((agent) => {
                  const isSelected = tempAgentId ? agent.id === tempAgentId : agent.id === selectedAgentId
                  return (
                    <button
                      key={agent.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleAgentClick(agent.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap",
                        isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"
                      )}
                    >
                      <AgentIcon agentId={agent.id} className="w-3.5 h-3.5 flex-shrink-0" />
                      {agent.name}
                    </button>
                  )
                })}
              </div>

              {/* Dynamic Columns */}
              {panelAgent.columns.map((column, columnIndex) => {
                if (!shouldShowColumn(columnIndex)) return null
                const options = getColumnOptions(
                  column,
                  tempAgentId ? tempSelections : { ...selections, ...tempSelections }
                )
                if (options.length === 0) return null
                const currentValue = getPanelSelection(column.id)
                const currentAgentId = tempAgentId ?? selectedAgentId

                return (
                  <div key={column.id} className="p-1">
                    <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {column.label}
                    </div>
                    {options.map((option) => {
                      const isSelected = option.id === currentValue
                      const isDefault = isConfigDefault(column.id, option.id)
                      
                      return (
                        <button
                          key={option.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleColumnClick(column.id, option.id, columnIndex)}
                          className={cn(
                            "group relative w-full flex items-center px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap",
                            isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"
                          )}
                        >
                          <span>{option.label}</span>
                          
                          {/* 默认值: hover 时在右侧浮层显示 default + 设置图标 */}
                          {isDefault && (
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-popover/95 rounded">
                              <span className="text-[10px] text-muted-foreground">default</span>
                              {onOpenAgentSettings && (
                                <button
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    closeSelector()
                                    onOpenAgentSettings(currentAgentId)
                                  }}
                                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                  title={`Edit ${panelAgent.name} config`}
                                >
                                  <Settings className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ============ Controlled Agent Selector Component ============

interface ControlledAgentSelectorProps {
  selectedAgentId: string
  selections: Record<string, string>
  displayName: string
  showSelector: boolean
  isUsingConfigDefaults?: boolean
  panelAgent: AgentConfig
  tempAgentId: string | null
  tempSelections: Record<string, string>
  onOpen: () => void
  onClose: () => void
  onAgentClick: (agentId: string) => void
  onColumnClick: (columnId: string, value: string, columnIndex: number) => void
  getPanelSelection: (columnId: string) => string
  shouldShowColumn: (columnIndex: number) => boolean
  isConfigDefault?: (columnId: string, value: string) => boolean
  onResetToDefaults?: () => void
  onOpenAgentSettings?: (agentId: string) => void
  className?: string
  dropdownPosition?: "top" | "bottom"
}

export function ControlledAgentSelector({
  selectedAgentId,
  selections,
  displayName,
  showSelector,
  isUsingConfigDefaults = true,
  panelAgent,
  tempAgentId,
  tempSelections,
  onOpen,
  onClose,
  onAgentClick,
  onColumnClick,
  getPanelSelection,
  shouldShowColumn,
  isConfigDefault,
  onResetToDefaults,
  onOpenAgentSettings,
  className,
  dropdownPosition = "bottom",
}: ControlledAgentSelectorProps) {
  return (
    <div className={cn("relative", className)}>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          showSelector && "bg-muted text-foreground"
        )}
      >
        <AgentIcon agentId={selectedAgentId} className="w-3.5 h-3.5" />
        <span className="whitespace-nowrap">{displayName}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", showSelector && "rotate-180")} />
      </button>

      {showSelector && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div
            className={cn(
              "absolute left-0 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden",
              dropdownPosition === "top" ? "bottom-full mb-1" : "top-full mt-1"
            )}
          >
            <div className="flex divide-x divide-border">
              {/* Agent Column */}
              <div className="p-1">
                <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Agent
                </div>
                {agentConfigs.map((agent) => {
                  const isSelected = tempAgentId ? agent.id === tempAgentId : agent.id === selectedAgentId
                  return (
                    <button
                      key={agent.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onAgentClick(agent.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap",
                        isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"
                      )}
                    >
                      <AgentIcon agentId={agent.id} className="w-3.5 h-3.5 flex-shrink-0" />
                      {agent.name}
                    </button>
                  )
                })}
              </div>

              {/* Dynamic Columns */}
              {panelAgent.columns.map((column, columnIndex) => {
                if (!shouldShowColumn(columnIndex)) return null
                const options = getColumnOptions(
                  column,
                  tempAgentId ? tempSelections : { ...selections, ...tempSelections }
                )
                if (options.length === 0) return null
                const currentValue = getPanelSelection(column.id)
                const currentAgentId = tempAgentId ?? selectedAgentId

                return (
                  <div key={column.id} className="p-1">
                    <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {column.label}
                    </div>
                    {options.map((option) => {
                      const isSelected = option.id === currentValue
                      const isDefault = isConfigDefault?.(column.id, option.id) ?? false
                      
                      return (
                        <button
                          key={option.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onColumnClick(column.id, option.id, columnIndex)}
                          className={cn(
                            "group relative w-full flex items-center px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap",
                            isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"
                          )}
                        >
                          <span>{option.label}</span>
                          
                          {/* 默认值: hover 时在右侧浮层显示 default + 设置图标 */}
                          {isDefault && (
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-popover/95 rounded">
                              <span className="text-[10px] text-muted-foreground">default</span>
                              {onOpenAgentSettings && (
                                <button
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onClose()
                                    onOpenAgentSettings(currentAgentId)
                                  }}
                                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                  title={`Edit ${panelAgent.name} config`}
                                >
                                  <Settings className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
