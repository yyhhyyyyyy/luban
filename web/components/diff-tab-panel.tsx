"use client"

import { useEffect, useRef, useState } from "react"
import { AlignJustify, ChevronDown, ChevronRight, Columns2, GitCompareArrows } from "lucide-react"

import { cn } from "@/lib/utils"
import { MultiFileDiff, type FileContents } from "@pierre/diffs/react"
import type { ChangedFile } from "./right-sidebar"

export type DiffStyle = "split" | "unified"

export interface DiffFileData {
  file: ChangedFile
  oldFile: FileContents
  newFile: FileContents
}

export function DiffTabPanel({
  isLoading,
  error,
  files,
  activeFileId,
  diffStyle,
  onStyleChange,
}: {
  isLoading: boolean
  error: string | null
  files: DiffFileData[]
  activeFileId?: string
  diffStyle: DiffStyle
  onStyleChange: (style: DiffStyle) => void
}) {
  if (isLoading) {
    return <div className="px-4 py-3 text-xs text-muted-foreground">Loading…</div>
  }

  if (error) {
    return <div className="px-4 py-3 text-xs text-destructive">{error}</div>
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <GitCompareArrows className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-xs">No changes</span>
      </div>
    )
  }

  return (
    <AllFilesDiffViewer
      files={files}
      activeFileId={activeFileId}
      diffStyle={diffStyle}
      onStyleChange={onStyleChange}
    />
  )
}

function AllFilesDiffViewer({
  files,
  activeFileId,
  diffStyle,
  onStyleChange,
}: {
  files: DiffFileData[]
  activeFileId?: string
  diffStyle: DiffStyle
  onStyleChange: (style: DiffStyle) => void
}) {
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const prevActiveFileIdRef = useRef<string | undefined>(undefined)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set())

  const toggleCollapse = (fileId: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  useEffect(() => {
    if (!activeFileId) return
    if (activeFileId === prevActiveFileIdRef.current) return

    const el = fileRefs.current[activeFileId]
    if (!el) return

    if (collapsedFiles.has(activeFileId)) {
      setCollapsedFiles((prev) => {
        const next = new Set(prev)
        next.delete(activeFileId)
        return next
      })
    }

    el.scrollIntoView({ behavior: "smooth", block: "start" })
    prevActiveFileIdRef.current = activeFileId
  }, [activeFileId, collapsedFiles])

  const getStatusColor = (status: ChangedFile["status"]) => {
    switch (status) {
      case "modified":
        return "text-status-warning"
      case "added":
        return "text-status-success"
      case "deleted":
        return "text-status-error"
      case "renamed":
        return "text-status-info"
      default:
        return "text-muted-foreground"
    }
  }

  const getStatusLabel = (status: ChangedFile["status"]) => {
    switch (status) {
      case "modified":
        return "M"
      case "added":
        return "A"
      case "deleted":
        return "D"
      case "renamed":
        return "R"
      default:
        return "?"
    }
  }

  const totalAdditions = files.reduce((sum, f) => sum + (f.file.additions ?? 0), 0)
  const totalDeletions = files.reduce((sum, f) => sum + (f.file.deletions ?? 0), 0)

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background" data-testid="diff-viewer">
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border text-xs">
        <span className="text-foreground font-medium">{files.length} files changed</span>
        <span className="text-muted-foreground">
          {totalAdditions > 0 && <span className="text-status-success">+{totalAdditions}</span>}
          {totalAdditions > 0 && totalDeletions > 0 && <span className="mx-1">/</span>}
          {totalDeletions > 0 && <span className="text-status-error">-{totalDeletions}</span>}
        </span>
        <div className="ml-auto flex items-center gap-0.5 p-0.5 bg-muted rounded">
          <button
            onClick={() => onStyleChange("split")}
            className={cn(
              "p-1 rounded transition-colors",
              diffStyle === "split"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Split view"
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onStyleChange("unified")}
            className={cn(
              "p-1 rounded transition-colors",
              diffStyle === "unified"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Unified view"
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {files.map((fileData) => {
          const isCollapsed = collapsedFiles.has(fileData.file.id)
          return (
            <div
              key={fileData.file.id}
              ref={(el) => {
                fileRefs.current[fileData.file.id] = el
              }}
              className="border-b border-border last:border-b-0"
            >
              <button
                onClick={() => toggleCollapse(fileData.file.id)}
                className="sticky top-0 z-[5] w-full flex items-center gap-2 px-4 py-2 bg-muted/80 backdrop-blur-sm border-b border-border/50 text-xs hover:bg-muted transition-colors text-left"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                )}
                <span className={cn("font-mono font-semibold", getStatusColor(fileData.file.status))}>
                  {getStatusLabel(fileData.file.status)}
                </span>
                <span className="font-mono text-foreground">{fileData.file.path}</span>
                {fileData.file.additions != null && fileData.file.additions > 0 && (
                  <span className="text-status-success">+{fileData.file.additions}</span>
                )}
                {fileData.file.deletions != null && fileData.file.deletions > 0 && (
                  <span className="text-status-error">-{fileData.file.deletions}</span>
                )}
              </button>

              {!isCollapsed && (
                <MultiFileDiff
                  oldFile={fileData.oldFile}
                  newFile={fileData.newFile}
                  options={{
                    theme: { dark: "pierre-dark", light: "pierre-light" },
                    diffStyle: diffStyle,
                    diffIndicators: "bars",
                    hunkSeparators: "line-info",
                    lineDiffType: "word-alt",
                    enableLineSelection: true,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

