"use client"

import type { ElementType, MouseEvent } from "react"

import { useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Bot,
  CheckCircle2,
  GitPullRequest,
  Lightbulb,
  ListTodo,
  MessageSquare,
  HelpCircle,
  Bug,
  FileCode,
  FileText,
  Folder,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Pencil,
  RefreshCw,
  Settings,
  Sun,
  Type,
  X,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { useAppearance } from "@/components/appearance-provider"
import { Markdown } from "@/components/markdown"
import { useLuban } from "@/lib/luban-context"
import { cn } from "@/lib/utils"
import type { AppearanceTheme, CodexConfigEntrySnapshot, TaskIntentKind } from "@/lib/luban-api"

interface SettingsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TocItem = {
  id: string
  label: string
  icon: ElementType
  children?: { id: string; label: string; icon: ElementType }[]
}

const tocItems: TocItem[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    children: [
      { id: "theme", label: "Theme", icon: Sun },
      { id: "fonts", label: "Fonts", icon: Type },
    ],
  },
  {
    id: "agent",
    label: "Agent",
    icon: Bot,
  },
  {
    id: "task",
    label: "Task",
    icon: ListTodo,
  },
]

const themeOptions: { id: AppearanceTheme; label: string; icon: ElementType }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
]

const themeColors = {
  light: {
    bg: "bg-gray-50",
    sidebar: "bg-gray-100",
    border: "border-gray-200",
    secondary: "bg-gray-200/60",
    primaryBg: "bg-blue-600",
    accent: "bg-blue-50",
  },
  dark: {
    bg: "bg-zinc-900",
    sidebar: "bg-zinc-800",
    border: "border-zinc-700",
    secondary: "bg-zinc-700/60",
    primaryBg: "bg-blue-500",
    accent: "bg-blue-900/30",
  },
}

function intentLabel(kind: TaskIntentKind): string {
  switch (kind) {
    case "fix":
      return "Fix"
    case "implement":
      return "Implement"
    case "review":
      return "Review"
    case "discuss":
      return "Discuss"
    case "other":
      return "Other"
  }
}

function renderTaskPromptPreview(template: string, kind: TaskIntentKind): string {
  const taskInput = "Example: Investigate why tests are flaky on CI and propose a fix."
  const knownContext = ["Known context:", "- Project: Unspecified", "- Context: None"].join("\n")

  return template
    .replaceAll("{{task_input}}", taskInput)
    .replaceAll("{{intent_label}}", intentLabel(kind))
    .replaceAll("{{known_context}}", knownContext)
}

function TaskPromptEditor({
  templates,
  appRev,
  setTaskPromptTemplate,
}: {
  templates: { intent_kind: TaskIntentKind; template: string }[]
  appRev: number | undefined
  setTaskPromptTemplate: (kind: TaskIntentKind, template: string) => void
}) {
  const templateByKind = useRef(new Map<TaskIntentKind, string>())
  templateByKind.current = new Map(templates.map((t) => [t.intent_kind, t.template]))

  const kinds: { kind: TaskIntentKind; label: string; icon: ElementType }[] = [
    { kind: "fix", label: "Fix", icon: Bug },
    { kind: "implement", label: "Implement", icon: Lightbulb },
    { kind: "review", label: "Review", icon: GitPullRequest },
    { kind: "discuss", label: "Discuss", icon: MessageSquare },
    { kind: "other", label: "Other", icon: HelpCircle },
  ]

  const [selected, setSelected] = useState<TaskIntentKind>("fix")
  const [value, setValue] = useState(() => templateByKind.current.get("fix") ?? "")
  const saveTimerRef = useRef<number | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const isSyncScrollingRef = useRef(false)

  useEffect(() => {
    setValue(templateByKind.current.get(selected) ?? "")
  }, [selected, appRev])

  useEffect(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current)
    }
    if (!value.trim()) return

    saveTimerRef.current = window.setTimeout(() => {
      setTaskPromptTemplate(selected, value)
    }, 800)

    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [selected, value, setTaskPromptTemplate])

  const syncScroll = (
    source: "editor" | "preview",
    sourceEl: HTMLTextAreaElement | HTMLDivElement,
    targetEl: HTMLTextAreaElement | HTMLDivElement,
  ) => {
    if (isSyncScrollingRef.current) return
    isSyncScrollingRef.current = true

    const sourceScrollTop = sourceEl.scrollTop
    const sourceScrollHeight = sourceEl.scrollHeight
    const sourceClientHeight = sourceEl.clientHeight
    const ratio = sourceScrollTop / Math.max(1, sourceScrollHeight - sourceClientHeight)

    const targetScrollHeight = targetEl.scrollHeight
    const targetClientHeight = targetEl.clientHeight
    targetEl.scrollTop = ratio * Math.max(1, targetScrollHeight - targetClientHeight)

    window.requestAnimationFrame(() => {
      isSyncScrollingRef.current = false
    })
  }

  return (
    <div data-testid="task-prompt-editor" className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
      <div className="flex items-center gap-1 px-3 py-2 bg-muted/50 border-b border-border overflow-x-auto">
        {kinds.map(({ kind, label, icon: Icon }) => {
          const isSelected = selected === kind
          return (
            <button
              key={kind}
              data-testid={`task-prompt-tab-${kind}`}
              onClick={() => setSelected(kind)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
                isSelected
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex divide-x divide-border h-[400px]">
        <div className="flex-1 flex flex-col min-w-0">
          <textarea
            ref={editorRef}
            data-testid="task-prompt-template"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onScroll={() => {
              const editor = editorRef.current
              const preview = previewRef.current
              if (!editor || !preview) return
              syncScroll("editor", editor, preview)
            }}
            className="flex-1 w-full bg-transparent text-xs font-mono leading-relaxed resize-none focus:outline-none text-foreground p-3"
            spellCheck={false}
            placeholder="Edit the task prompt template..."
          />
        </div>
        <div className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/30 opacity-40">
            <div className="h-2.5 w-24 rounded bg-muted-foreground/30" />
            <div className="h-2 w-8 rounded bg-muted-foreground/20" />
          </div>

          <div className="flex items-center px-2 py-1.5 border-b border-border bg-muted/20 opacity-40">
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted-foreground/20">
              <div className="w-2.5 h-2.5 rounded bg-muted-foreground/30" />
              <div className="h-2 w-12 rounded bg-muted-foreground/30" />
            </div>
          </div>

          <div
            ref={previewRef}
            className="flex-1 overflow-y-auto p-3"
            onScroll={() => {
              const editor = editorRef.current
              const preview = previewRef.current
              if (!editor || !preview) return
              syncScroll("preview", preview, editor)
            }}
          >
            <div className="flex justify-end">
              <div className="max-w-[85%] border border-border rounded-lg px-3 py-2.5 bg-muted/30 luban-font-chat">
                <Markdown content={renderTaskPromptPreview(value, selected)} className="text-[12px]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemePreviewCard({
  themeId,
  label,
  icon: Icon,
  isSelected,
  onClick,
  testId,
}: {
  themeId: string
  label: string
  icon: ElementType
  isSelected: boolean
  onClick: () => void
  testId?: string
}) {
  const isSystem = themeId === "system"
  const colors = themeColors[themeId as keyof typeof themeColors] || themeColors.light

  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex-1 rounded-xl border-2 overflow-hidden transition-all",
        isSelected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50",
      )}
    >
      <div className={cn("h-24 flex", isSystem ? "" : colors.bg)}>
        {isSystem ? (
          <>
            <div className="flex-1 flex bg-gray-50">
              <div className={cn("w-12 border-r", themeColors.light.sidebar, themeColors.light.border)}>
                <div className={cn("h-5 border-b flex items-center px-1.5", themeColors.light.border)}>
                  <div className="w-3 h-3 rounded bg-gray-300" />
                </div>
                <div className="p-1.5 space-y-1">
                  <div className="h-2 w-8 rounded bg-gray-300" />
                  <div className="h-2 w-6 rounded bg-blue-100" />
                  <div className="h-2 w-7 rounded bg-gray-200" />
                </div>
              </div>
              <div className="flex-1 flex flex-col">
                <div className={cn("h-5 border-b", themeColors.light.border)} />
                <div className="flex-1 p-2 space-y-1.5">
                  <div className="h-5 rounded bg-gray-200/60" />
                  <div className="h-8 rounded bg-gray-200/60" />
                </div>
              </div>
            </div>
            <div className="flex-1 flex bg-zinc-900">
              <div className="flex-1 flex flex-col">
                <div className={cn("h-5 border-b", themeColors.dark.border)} />
                <div className="flex-1 p-2 space-y-1.5">
                  <div className="h-5 rounded bg-zinc-700/60" />
                  <div className="h-8 rounded bg-zinc-700/60" />
                </div>
              </div>
              <div className={cn("w-10 border-l", themeColors.dark.border)}>
                <div className={cn("h-5 border-b", themeColors.dark.border)} />
                <div className="flex-1 p-1 bg-zinc-700/60">
                  <div className="h-1.5 w-6 rounded bg-green-500/40" />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className={cn("w-12 border-r", colors.sidebar, colors.border)}>
              <div className={cn("h-5 border-b flex items-center px-1.5", colors.border)}>
                <div className={cn("w-3 h-3 rounded", colors.secondary)} />
              </div>
              <div className="p-1.5 space-y-1">
                <div className={cn("h-2 w-8 rounded", colors.secondary)} />
                <div className={cn("h-2 w-6 rounded", colors.accent)} />
                <div className={cn("h-2 w-7 rounded", colors.secondary)} />
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              <div className={cn("h-5 border-b", colors.border)} />
              <div className="flex-1 p-2 space-y-1.5">
                <div className={cn("h-5 rounded", colors.secondary)} />
                <div className={cn("h-8 rounded", colors.secondary)} />
              </div>
            </div>
            <div className={cn("w-10 border-l", colors.border)}>
              <div className={cn("h-5 border-b", colors.border)} />
              <div className={cn("flex-1 p-1", colors.secondary)}>
                <div className={cn("h-1.5 w-6 rounded", themeId === "dark" ? "bg-green-500/40" : "bg-green-600/30")} />
              </div>
            </div>
          </>
        )}
      </div>

      <div
        className={cn(
          "flex items-center justify-center gap-2 py-2 border-t",
          isSelected ? "bg-primary/5 border-primary/20" : "bg-secondary/30 border-border",
        )}
      >
        <Icon className={cn("w-4 h-4", isSelected ? "text-primary" : "text-muted-foreground")} />
        <span className={cn("text-sm font-medium", isSelected ? "text-primary" : "text-foreground")}>{label}</span>
        {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
      </div>
    </button>
  )
}

const mockLocalFonts = [
  "Inter",
  "SF Pro",
  "SF Pro Display",
  "Helvetica Neue",
  "Arial",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Nunito",
  "Source Sans Pro",
  "Segoe UI",
  "Georgia",
  "Source Serif Pro",
  "Merriweather",
  "Lora",
]

const mockMonoFonts = [
  "Geist Mono",
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Source Code Pro",
  "IBM Plex Mono",
  "Cascadia Code",
  "Roboto Mono",
  "Ubuntu Mono",
  "Inconsolata",
]

function InlineFontSelect({
  value,
  onChange,
  fonts,
  mono,
  label,
  vertical,
  testId,
}: {
  value: string
  onChange: (value: string) => void
  fonts: string[]
  mono?: boolean
  label: string
  vertical?: boolean
  testId?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn("relative", vertical ? "flex flex-col gap-1" : "inline-flex items-center gap-1.5")}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <button
        data-testid={testId}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all",
          "bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30",
          "shadow-sm hover:shadow",
          open && "ring-2 ring-primary/40 bg-primary/25",
        )}
      >
        <span
          className={mono ? "font-mono" : ""}
          style={{ fontFamily: `"${value}", ${mono ? "monospace" : "sans-serif"}` }}
        >
          {value}
        </span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            data-testid={testId ? `${testId}-menu` : undefined}
            className="absolute top-full left-0 mt-1.5 z-50 bg-popover border border-border rounded-lg shadow-xl max-h-52 w-44 overflow-y-auto"
          >
            <div className="p-1">
              {fonts.map((font) => {
                const isSelected = value === font
                return (
                  <button
                    key={font}
                    onClick={() => {
                      onChange(font)
                      setOpen(false)
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-2.5 py-1.5 text-left transition-colors text-xs rounded-md",
                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent",
                    )}
                  >
                    <span
                      className={mono ? "font-mono" : ""}
                      style={{ fontFamily: `"${font}", ${mono ? "monospace" : "sans-serif"}` }}
                    >
                      {font}
                    </span>
                    {isSelected && <Check className="w-3 h-3" />}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function WorkspacePreviewWithFonts({
  uiFont,
  chatFont,
  monoFont,
  terminalFont,
  setUiFont,
  setChatFont,
  setMonoFont,
  setTerminalFont,
}: {
  uiFont: string
  chatFont: string
  monoFont: string
  terminalFont: string
  setUiFont: (v: string) => void
  setChatFont: (v: string) => void
  setMonoFont: (v: string) => void
  setTerminalFont: (v: string) => void
}) {
  return (
    <div className="w-full border border-border rounded-xl overflow-hidden bg-background shadow-lg pointer-events-none select-none">
      <div className="flex h-80">
        <div className="w-40 border-r border-border bg-sidebar flex flex-col">
          <div className="h-9 px-3 border-b border-border flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-muted-foreground/20" />
            <div className="h-3 w-16 rounded bg-muted-foreground/20" />
          </div>

          <div className="flex-1 p-3 space-y-2">
            <div className="mb-3 pointer-events-auto">
              <InlineFontSelect
                testId="settings-ui-font"
                label="UI Font"
                value={uiFont}
                onChange={setUiFont}
                fonts={mockLocalFonts}
                vertical
              />
            </div>

            <div className="px-1" style={{ fontFamily: `"${uiFont}", sans-serif` }}>
              <p className="text-xs text-muted-foreground leading-relaxed">The quick brown fox jumps over the lazy dog</p>
            </div>
          </div>

          <div className="border-t border-border p-2 opacity-40">
            <div className="h-2.5 w-20 rounded bg-muted-foreground/30" />
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-9 border-b border-border px-3 flex items-center gap-2 opacity-40">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted-foreground/20">
              <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
              <div className="h-2 w-10 rounded bg-muted-foreground/30" />
            </div>
          </div>

          <div className="flex-1 p-4 overflow-hidden">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="pointer-events-auto">
                  <InlineFontSelect
                    testId="settings-chat-font"
                    label="Chat Font"
                    value={chatFont}
                    onChange={setChatFont}
                    fonts={mockLocalFonts}
                  />
                </div>
                <div className="bg-secondary/50 border border-border rounded-lg p-3" style={{ fontFamily: `"${chatFont}", sans-serif` }}>
                  <p className="text-sm leading-relaxed text-muted-foreground">The quick brown fox jumps over the lazy dog</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="pointer-events-auto">
                  <InlineFontSelect
                    testId="settings-code-font"
                    label="Code Font"
                    value={monoFont}
                    onChange={setMonoFont}
                    fonts={mockMonoFonts}
                    mono
                  />
                </div>
                <div className="bg-secondary/60 border border-border rounded-lg p-3" style={{ fontFamily: `"${monoFont}", monospace` }}>
                  <pre className="text-sm leading-relaxed">
                    <span className="text-blue-600">fn</span> <span className="text-amber-600">hello</span>
                    <span className="text-muted-foreground">()</span> <span className="text-blue-600">{"->"}</span>{" "}
                    <span className="text-green-600">String</span> <span className="text-muted-foreground">{"{"}</span>
                    {"\n"}
                    {"    "}
                    <span className="text-orange-500">"The quick brown fox"</span>
                    <span className="text-muted-foreground">.to_string()</span>
                    {"\n"}
                    <span className="text-muted-foreground">{"}"}</span>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="w-48 border-l border-border flex flex-col">
          <div className="h-9 border-b border-border px-3 flex items-center opacity-40">
            <div className="h-2 w-12 rounded bg-muted-foreground/30" />
          </div>
          <div className="flex-1 bg-secondary/40 flex flex-col">
            <div className="px-3 py-2 pointer-events-auto">
              <InlineFontSelect
                testId="settings-terminal-font"
                label="Terminal Font"
                value={terminalFont}
                onChange={setTerminalFont}
                fonts={mockMonoFonts}
                mono
                vertical
              />
            </div>
            <div className="flex-1 px-3 pb-3" style={{ fontFamily: `"${terminalFont}", monospace` }}>
              <p className="text-sm leading-relaxed text-muted-foreground">The quick brown fox jumps over the lazy dog</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type CheckStatus = "idle" | "checking" | "success" | "error"

type SaveStatus = "idle" | "unsaved" | "saving" | "saved"

type CodexSelectedFile = {
  path: string
  name: string
}

function codexEntryIcon(entry: CodexConfigEntrySnapshot): { icon: ElementType; className: string } {
  if (entry.kind === "folder") {
    return { icon: Folder, className: "text-yellow-500" }
  }

  if (entry.name.endsWith(".toml") || entry.name.endsWith(".json") || entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
    return { icon: FileCode, className: "text-orange-500" }
  }

  return { icon: FileText, className: "text-blue-500" }
}

function CodexConfigTree({
  entries,
  level = 0,
  selectedPath,
  expandedFolders,
  onSelectFile,
  onToggleFolder,
}: {
  entries: CodexConfigEntrySnapshot[]
  level?: number
  selectedPath: string | null
  expandedFolders: Set<string>
  onSelectFile: (file: CodexSelectedFile) => void
  onToggleFolder: (path: string) => void
}) {
  return (
    <div className="space-y-0.5">
      {entries.map((entry) => {
        const isFolder = entry.kind === "folder"
        const isExpanded = isFolder && expandedFolders.has(entry.path)
        const isSelected = selectedPath === entry.path
        const { icon: Icon, className } = codexEntryIcon(entry)

        return (
          <div key={entry.path}>
            <button
              onClick={() => {
                if (isFolder) {
                  onToggleFolder(entry.path)
                } else {
                  onSelectFile({ path: entry.path, name: entry.name })
                }
              }}
              className={cn(
                "w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors text-xs",
                isSelected ? "bg-primary/15 text-primary" : "hover:bg-secondary/50 text-foreground/80",
              )}
              style={{ paddingLeft: `${8 + level * 12}px` }}
            >
              {isFolder ? (
                <ChevronRight
                  className={cn(
                    "w-3 h-3 text-muted-foreground transition-transform flex-shrink-0",
                    isExpanded && "rotate-90",
                  )}
                />
              ) : (
                <div className="w-3" />
              )}
              <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", className)} />
              <span className="truncate">{entry.name}</span>
            </button>

            {isFolder && isExpanded && entry.children.length > 0 && (
              <CodexConfigTree
                entries={entry.children}
                level={level + 1}
                selectedPath={selectedPath}
                expandedFolders={expandedFolders}
                onSelectFile={onSelectFile}
                onToggleFolder={onToggleFolder}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function CodexConfigEditor({
  enabled,
  saveStatus,
  onSaveStatusChange,
}: {
  enabled: boolean
  saveStatus: SaveStatus
  onSaveStatusChange: (status: SaveStatus) => void
}) {
  const { getCodexConfigTree, readCodexConfigFile, writeCodexConfigFile } = useLuban()
  const [tree, setTree] = useState<CodexConfigEntrySnapshot[]>([])
  const [selectedFile, setSelectedFile] = useState<CodexSelectedFile | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(["skills"]))
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const saveTimeoutRef = useRef<number | null>(null)
  const saveIdleTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    void getCodexConfigTree()
      .then((entries) => setTree(entries))
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
  }, [enabled, getCodexConfigTree])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current != null) window.clearTimeout(saveTimeoutRef.current)
      if (saveIdleTimeoutRef.current != null) window.clearTimeout(saveIdleTimeoutRef.current)
    }
  }, [])

  const handleToggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleSelectFile = async (file: CodexSelectedFile) => {
    setSelectedFile(file)
    if (fileContents[file.path] != null) return
    try {
      const contents = await readCodexConfigFile(file.path)
      setFileContents((prev) => ({ ...prev, [file.path]: contents }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleContentChange = (content: string) => {
    if (!selectedFile) return

    setFileContents((prev) => ({ ...prev, [selectedFile.path]: content }))
    onSaveStatusChange("unsaved")

    if (saveTimeoutRef.current != null) window.clearTimeout(saveTimeoutRef.current)
    if (saveIdleTimeoutRef.current != null) window.clearTimeout(saveIdleTimeoutRef.current)

    saveTimeoutRef.current = window.setTimeout(() => {
      onSaveStatusChange("saving")
      const path = selectedFile.path
      void writeCodexConfigFile(path, content)
        .then(() => {
          onSaveStatusChange("saved")
          saveIdleTimeoutRef.current = window.setTimeout(() => {
            onSaveStatusChange("idle")
          }, 1500)
        })
        .catch((err) => {
          onSaveStatusChange("unsaved")
          toast.error(err instanceof Error ? err.message : String(err))
        })
    }, 800)
  }

  const currentContent = selectedFile ? (fileContents[selectedFile.path] ?? "") : ""

  return (
    <div className="flex h-64 border-t border-border">
      <div className="w-44 border-r border-border bg-secondary/20 overflow-y-auto py-1.5">
        {tree.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No config found.</div>
        ) : (
          <CodexConfigTree
            entries={tree}
            selectedPath={selectedFile?.path ?? null}
            expandedFolders={expandedFolders}
            onSelectFile={handleSelectFile}
            onToggleFolder={handleToggleFolder}
          />
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedFile ? (
          <textarea
            data-testid="settings-codex-editor"
            value={currentContent}
            onChange={(e) => handleContentChange(e.target.value)}
            className="flex-1 p-3 bg-background text-xs font-mono text-foreground/80 leading-relaxed resize-none focus:outline-none"
            spellCheck={false}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Select a file to edit</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CodexSettings() {
  const { app, setCodexEnabled, checkCodex, addProject } = useLuban()
  const [enabled, setEnabled] = useState(true)
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("idle")
  const [checkMessage, setCheckMessage] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")

  useEffect(() => {
    const next = app?.agent?.codex_enabled ?? true
    setEnabled(next)
  }, [app?.rev])

  const handleCheck = async (e: MouseEvent) => {
    e.stopPropagation()
    setCheckStatus("checking")
    setCheckMessage(null)
    try {
      const res = await checkCodex()
      setCheckStatus(res.ok ? "success" : "error")
      setCheckMessage(res.message)
    } catch (err) {
      setCheckStatus("error")
      setCheckMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggleEnabled = (e: MouseEvent) => {
    e.stopPropagation()
    const next = !enabled
    setEnabled(next)
    setCodexEnabled(next)
  }

  const handleEditInLuban = (e: MouseEvent) => {
    e.stopPropagation()
    addProject("~/.codex")
    toast("Added ~/.codex as a project.")
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className={cn("w-full flex items-center justify-between px-4 py-3 transition-colors", enabled ? "" : "opacity-60")}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-black dark:bg-white text-white dark:text-black">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 4.529 2.094h.71l.147 1.02a2.5 2.5 0 0 0 2.478 2.149h5.02a2.5 2.5 0 0 0 2.478-2.149l.147-1.02h.71a5.98 5.98 0 0 0 4.529-2.094 6.046 6.046 0 0 0 1.0-4.457z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium">Codex</h4>
              {checkStatus === "success" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-green-500/10 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  Ready
                </span>
              )}
              {checkStatus === "error" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-600 dark:text-red-400">
                  <XCircle className="w-2.5 h-2.5" />
                  Error
                </span>
              )}
              {saveStatus !== "idle" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]",
                    saveStatus === "saved"
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {saveStatus === "saving" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                  {saveStatus === "saved" && <CheckCircle2 className="w-2.5 h-2.5" />}
                  {saveStatus === "saving" ? "Saving..." : saveStatus === "unsaved" ? "Unsaved" : "Saved"}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">OpenAI Codex CLI agent</p>
            {checkMessage && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{checkMessage}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {enabled && (
            <button
              data-testid="settings-codex-check"
              onClick={handleCheck}
              disabled={checkStatus === "checking"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all",
                checkStatus === "checking"
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-secondary hover:bg-secondary/80 text-foreground",
              )}
            >
              {checkStatus === "checking" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  Check
                </>
              )}
            </button>
          )}

          {enabled && (
            <button
              data-testid="settings-codex-edit-in-luban"
              onClick={handleEditInLuban}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Edit in Luban
            </button>
          )}

          <button
            data-testid="settings-codex-toggle"
            onClick={handleToggleEnabled}
            className={cn("relative w-9 h-5 rounded-full transition-colors", enabled ? "bg-primary" : "bg-muted")}
            title={enabled ? "Disable Codex" : "Enable Codex"}
          >
            <div
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </div>

      {enabled && <CodexConfigEditor enabled={enabled} saveStatus={saveStatus} onSaveStatusChange={setSaveStatus} />}
    </div>
  )
}

function AllSettings() {
  const { theme, setTheme } = useTheme()
  const { fonts, setFonts } = useAppearance()
  const { app, setAppearanceTheme, setAppearanceFonts, setTaskPromptTemplate } = useLuban()
  const resolvedTheme = theme ?? "system"

  return (
    <div className="space-y-12">
      <section id="theme" className="scroll-mt-8">
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
          <Sun className="w-4 h-4 text-muted-foreground" />
          Theme
        </h3>
        <div className="flex gap-4">
          {themeOptions.map((option) => (
            <ThemePreviewCard
              key={option.id}
              themeId={option.id}
              label={option.label}
              icon={option.icon}
              isSelected={resolvedTheme === option.id}
              onClick={() => {
                setTheme(option.id)
                setAppearanceTheme(option.id)
              }}
              testId={`settings-theme-${option.id}`}
            />
          ))}
        </div>
      </section>

      <section id="fonts" className="scroll-mt-8">
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
          <Type className="w-4 h-4 text-muted-foreground" />
          Fonts
        </h3>
        <WorkspacePreviewWithFonts
          uiFont={fonts.uiFont}
          chatFont={fonts.chatFont}
          monoFont={fonts.codeFont}
          terminalFont={fonts.terminalFont}
          setUiFont={(uiFont) => {
            const next = { ...fonts, uiFont }
            setFonts({ uiFont })
            setAppearanceFonts({
              ui_font: next.uiFont,
              chat_font: next.chatFont,
              code_font: next.codeFont,
              terminal_font: next.terminalFont,
            })
          }}
          setChatFont={(chatFont) => {
            const next = { ...fonts, chatFont }
            setFonts({ chatFont })
            setAppearanceFonts({
              ui_font: next.uiFont,
              chat_font: next.chatFont,
              code_font: next.codeFont,
              terminal_font: next.terminalFont,
            })
          }}
          setMonoFont={(codeFont) => {
            const next = { ...fonts, codeFont }
            setFonts({ codeFont })
            setAppearanceFonts({
              ui_font: next.uiFont,
              chat_font: next.chatFont,
              code_font: next.codeFont,
              terminal_font: next.terminalFont,
            })
          }}
          setTerminalFont={(terminalFont) => {
            const next = { ...fonts, terminalFont }
            setFonts({ terminalFont })
            setAppearanceFonts({
              ui_font: next.uiFont,
              chat_font: next.chatFont,
              code_font: next.codeFont,
              terminal_font: next.terminalFont,
            })
          }}
        />
      </section>

      <section id="agent" className="scroll-mt-8">
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
          <Bot className="w-4 h-4 text-muted-foreground" />
          Agent
        </h3>
        <div className="space-y-4">
          <CodexSettings />
        </div>
      </section>

      <section id="task" className="scroll-mt-8">
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-muted-foreground" />
          Task
        </h3>
        <TaskPromptEditor
          templates={app?.task?.prompt_templates ?? []}
          appRev={app?.rev}
          setTaskPromptTemplate={setTaskPromptTemplate}
        />
      </section>
    </div>
  )
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(["appearance"]))
  const [activeItem, setActiveItem] = useState<string>("theme")
  const contentRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const scrollToSection = (id: string) => {
    setActiveItem(id)
    const element = document.getElementById(id)
    if (element && contentRef.current) {
      element.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <div data-testid="settings-panel" className="fixed inset-0 z-50 bg-background flex">
      <div className="w-60 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
        <div className="flex items-center justify-between h-11 px-3 border-b border-border">
          <div className="flex items-center gap-2 px-1.5 py-1">
            <div className="flex items-center justify-center w-6 h-6 rounded bg-secondary">
              <Settings className="w-4 h-4 text-foreground" />
            </div>
            <span className="text-sm font-medium">Settings</span>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded transition-colors"
            title="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5">
          {tocItems.map((item) => {
            const Icon = item.icon
            const isExpanded = expandedItems.has(item.id)
            const hasChildren = !!item.children?.length

            return (
              <div key={item.id}>
                <div className="flex items-center hover:bg-sidebar-accent/50 transition-colors">
                  <button
                    onClick={() => (hasChildren ? toggleExpanded(item.id) : scrollToSection(item.id))}
                    className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left"
                  >
                    {hasChildren ? (
                      isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      )
                    ) : (
                      <Icon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    )}
                    <span
                      className={cn(
                        "text-sm truncate flex-1",
                        !hasChildren && activeItem === item.id ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                  </button>
                </div>

                {isExpanded && hasChildren && (
                  <div className="ml-4 pl-3 border-l border-border-subtle">
                    {item.children!.map((child) => {
                      const isActive = activeItem === child.id
                      const ChildIcon = child.icon
                      return (
                        <button
                          key={child.id}
                          onClick={() => scrollToSection(child.id)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors rounded mx-1",
                            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/30",
                          )}
                        >
                          <ChildIcon className={cn("w-3.5 h-3.5", isActive ? "text-primary" : "text-muted-foreground")} />
                          <span className={cn("text-xs", isActive ? "text-foreground" : "text-muted-foreground")}>{child.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="border-t border-border p-2">
          <div className="px-3 py-1.5 text-xs text-muted-foreground">Luban v0.1.0</div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="h-11 px-8 border-b border-border flex items-center">
          <h2 className="text-sm font-medium">Settings</h2>
        </div>
        <div ref={contentRef} className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl">
            <AllSettings />
          </div>
        </div>
      </div>
    </div>
  )
}
