"use client"

import type { ComponentType } from "react"

import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, Copy, FolderOpen } from "lucide-react"
import Image from "next/image"

import type { OpenTarget } from "@/lib/luban-api"
import { useLuban } from "@/lib/luban-context"
import { cn } from "@/lib/utils"

function BrandIcon({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={16}
      height={16}
      className={className}
      style={{ width: "auto", height: "auto", maxWidth: 14, maxHeight: 14 }}
    />
  )
}

export type EditorType = "vscode" | "cursor" | "zed"
export type ActionType = "copy-path" | "ghostty" | "finder"

type EditorConfig = {
  id: EditorType
  name: string
  icon: string
}

type ActionConfig = {
  id: ActionType
  name: string
  icon: string | ComponentType<{ className?: string }>
}

const editors: EditorConfig[] = [
  { id: "vscode", name: "VS Code", icon: "/icons/vscode.svg" },
  { id: "cursor", name: "Cursor", icon: "/icons/cursor.svg" },
  { id: "zed", name: "Zed", icon: "/icons/zed.svg" },
]

const actions: ActionConfig[] = [
  { id: "ghostty", name: "Ghostty", icon: "/icons/ghostty.png" },
  { id: "copy-path", name: "Copy Path", icon: Copy },
  { id: "finder", name: "Reveal in Finder", icon: FolderOpen },
]

type SelectedItem = { type: "editor"; id: EditorType } | { type: "action"; id: ActionType }

const STORAGE_KEY = "open-button-last-selection"

function getDefaultSelection(): SelectedItem {
  return { type: "editor", id: "vscode" }
}

function getStoredSelection(): SelectedItem {
  if (typeof window === "undefined") return getDefaultSelection()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.type === "editor" && editors.some((e) => e.id === parsed.id)) return parsed
      if (parsed.type === "action" && actions.some((a) => a.id === parsed.id)) return parsed
    }
  } catch {
    // ignore
  }
  return getDefaultSelection()
}

function saveSelection(selection: SelectedItem) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // ignore
  }
}

function getItemConfig(
  selection: SelectedItem,
): { name: string; icon: string | ComponentType<{ className?: string }> } {
  if (selection.type === "editor") {
    const editor = editors.find((e) => e.id === selection.id)
    return editor || editors[0]
  }
  const action = actions.find((a) => a.id === selection.id)
  return action || actions[0]
}

function renderIcon(icon: string | ComponentType<{ className?: string }>, className?: string) {
  if (typeof icon === "string") return <BrandIcon src={icon} alt="" className={className} />
  const Icon = icon
  return <Icon className={className} />
}

function selectionToTarget(selection: SelectedItem): OpenTarget | null {
  if (selection.type === "editor") return selection.id
  if (selection.id === "ghostty") return "ghostty"
  if (selection.id === "finder") return "finder"
  return null
}

export function OpenButton() {
  const { activeWorkspaceId, activeWorkspace, openWorkspaceWith } = useLuban()
  const [selection, setSelection] = useState<SelectedItem>(getDefaultSelection)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setSelection(getStoredSelection())
  }, [])

  const worktreePath = activeWorkspace?.worktree_path ?? null

  const disabled = activeWorkspaceId == null

  const config = useMemo(() => getItemConfig(selection), [selection])

  const executeAction = async (item: SelectedItem) => {
    if (disabled) return

    if (item.type === "action" && item.id === "copy-path") {
      if (!worktreePath) return
      try {
        await navigator.clipboard.writeText(worktreePath)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      } catch {
        setCopied(false)
      }
      return
    }

    const target = selectionToTarget(item)
    if (!target) return
    openWorkspaceWith(activeWorkspaceId, target)
  }

  const selectAndRun = (item: SelectedItem) => {
    setSelection(item)
    saveSelection(item)
    setOpen(false)
    void executeAction(item)
  }

  return (
    <div className="relative inline-flex">
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void executeAction(selection)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 text-xs transition-colors rounded-l",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          disabled && "opacity-60 cursor-default hover:bg-transparent hover:text-muted-foreground",
        )}
      >
        {copied && selection.type === "action" && selection.id === "copy-path" ? (
          <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
        ) : (
          renderIcon(config.icon, "w-3.5 h-3.5 flex-shrink-0")
        )}
        <span className="pr-1">{config.name}</span>
      </button>

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (disabled) return
          setOpen((prev) => !prev)
        }}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center w-5 py-1 transition-colors rounded-r",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          open && "bg-muted text-foreground",
          disabled && "opacity-60 cursor-default hover:bg-transparent hover:text-muted-foreground",
        )}
      >
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="p-1">
              {editors.map((editor) => (
                <button
                  key={editor.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectAndRun({ type: "editor", id: editor.id })}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap text-foreground hover:bg-accent"
                >
                  {renderIcon(editor.icon, "w-3.5 h-3.5 flex-shrink-0")}
                  <span className="flex-1">{editor.name}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-border" />
            <div className="p-1">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectAndRun({ type: "action", id: "ghostty" })}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap text-foreground hover:bg-accent"
              >
                {renderIcon("/icons/ghostty.png", "w-3.5 h-3.5 flex-shrink-0")}
                <span className="flex-1">Ghostty</span>
              </button>
            </div>
            <div className="border-t border-border" />
            <div className="p-1">
              {actions
                .filter((a) => a.id !== "ghostty")
                .map((action) => (
                  <button
                    key={action.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectAndRun({ type: "action", id: action.id })}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors rounded-md whitespace-nowrap text-foreground hover:bg-accent"
                  >
                    {renderIcon(action.icon, "w-3.5 h-3.5 flex-shrink-0")}
                    <span className="flex-1">{action.name}</span>
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
