"use client"
import { useState } from "react"
import type React from "react"

import { cn } from "@/lib/utils"
import {
  Terminal,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  ChevronRight,
  ChevronDown,
  File,
  FileImage,
  FileText,
  FileJson,
  FileCode,
  Folder,
  FolderOpen,
  Trash2,
  Copy,
  FilePlus,
  GitCompareArrows,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type RightPanelTab = "terminal" | "context" | "changes"

type FileChangeStatus = "modified" | "added" | "deleted" | "renamed"
type FileChangeGroup = "committed" | "staged" | "unstaged"

interface ChangedFile {
  id: string
  path: string
  name: string
  status: FileChangeStatus
  group: FileChangeGroup
  additions?: number
  deletions?: number
  oldPath?: string // for renamed files
}


interface RightSidebarProps {
  isOpen: boolean
  onToggle: () => void
  onOpenDiffTab?: (file: ChangedFile) => void
}

export function RightSidebar({ isOpen, onToggle, onOpenDiffTab }: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>("terminal")
  const [isDragOver, setIsDragOver] = useState(false)

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="absolute right-3 top-2 p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors z-10"
        title="Open sidebar"
      >
        <PanelRightOpen className="w-4 h-4" />
      </button>
    )
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (activeTab === "context") {
      e.preventDefault()
      setIsDragOver(true)
    }
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      console.log(
        "Dropped files:",
        Array.from(files).map((f) => f.name),
      )
    }
  }

  return (
    <div
      className={cn(
        "w-80 border-l border-border bg-card flex flex-col transition-colors",
        isDragOver && "bg-primary/5 border-primary/50",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center h-11 px-1.5 border-b border-border gap-1">
        {/* Terminal tab button */}
        <button
          onClick={() => setActiveTab("terminal")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded transition-all",
            activeTab === "terminal"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
          title="Terminal"
        >
          <Terminal className="w-4 h-4" />
          {activeTab === "terminal" && <span className="text-xs font-medium">Terminal</span>}
        </button>

        {/* Context tab button */}
        <button
          onClick={() => setActiveTab("context")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded transition-all",
            activeTab === "context"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
          title="Context"
        >
          <Paperclip className="w-4 h-4" />
          {activeTab === "context" && <span className="text-xs font-medium">Context</span>}
        </button>

        <button
          onClick={() => setActiveTab("changes")}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 rounded transition-all",
            activeTab === "changes"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
          title="Changes"
        >
          <GitCompareArrows className="w-4 h-4" />
          {activeTab === "changes" && <span className="text-xs font-medium">Changes</span>}
        </button>

        <div className="flex-1" />

        <button
          onClick={onToggle}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          title="Close sidebar"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "terminal" && <TerminalContent />}
        {activeTab === "context" && <ContextPanel isDragOver={isDragOver} />}
        {activeTab === "changes" && <ChangesPanel onOpenDiffTab={onOpenDiffTab} />}
      </div>
    </div>
  )
}

function TerminalContent() {
  return (
    <div className="p-3 font-mono text-xs">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-primary">luban</span>
          <span className="text-muted-foreground">on</span>
          <span className="text-accent">main</span>
          <span className="text-muted-foreground">is</span>
          <span className="text-chart-4">v0.1.0</span>
          <span className="text-muted-foreground">via</span>
          <span className="text-destructive">v1.92.0</span>
        </div>
        <div className="text-chart-4">❯</div>
      </div>
    </div>
  )
}

export const mockChangedFiles: ChangedFile[] = [
  // Committed
  {
    id: "c1",
    path: "src/components/sidebar.tsx",
    name: "sidebar.tsx",
    status: "modified",
    group: "committed",
    additions: 45,
    deletions: 12,
  },
  {
    id: "c2",
    path: "src/utils/helpers.ts",
    name: "helpers.ts",
    status: "added",
    group: "committed",
    additions: 28,
    deletions: 0,
  },
  // Staged
  {
    id: "s1",
    path: "src/components/chat-panel.tsx",
    name: "chat-panel.tsx",
    status: "modified",
    group: "staged",
    additions: 156,
    deletions: 43,
  },
  {
    id: "s2",
    path: "src/types/index.ts",
    name: "index.ts",
    status: "modified",
    group: "staged",
    additions: 8,
    deletions: 2,
  },
  // Unstaged
  {
    id: "u1",
    path: "src/components/kanban-board.tsx",
    name: "kanban-board.tsx",
    status: "modified",
    group: "unstaged",
    additions: 23,
    deletions: 5,
  },
  {
    id: "u2",
    path: "src/styles/globals.css",
    name: "globals.css",
    status: "modified",
    group: "unstaged",
    additions: 12,
    deletions: 8,
  },
  {
    id: "u3",
    path: "src/old-file.ts",
    name: "old-file.ts",
    status: "deleted",
    group: "unstaged",
    additions: 0,
    deletions: 45,
  },
  {
    id: "u4",
    path: "src/components/new-component.tsx",
    name: "new-component.tsx",
    status: "added",
    group: "unstaged",
    additions: 67,
    deletions: 0,
  },
]

interface ChangesPanelProps {
  onOpenDiffTab?: (file: ChangedFile) => void
}

function ChangesPanel({ onOpenDiffTab }: ChangesPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<FileChangeGroup>>(new Set(["staged", "unstaged"]))

  const toggleGroup = (group: FileChangeGroup) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(group)) {
      newExpanded.delete(group)
    } else {
      newExpanded.add(group)
    }
    setExpandedGroups(newExpanded)
  }

  const committedFiles = mockChangedFiles.filter((f) => f.group === "committed")
  const stagedFiles = mockChangedFiles.filter((f) => f.group === "staged")
  const unstagedFiles = mockChangedFiles.filter((f) => f.group === "unstaged")

  const getStatusColor = (status: FileChangeStatus) => {
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

  const getStatusLabel = (status: FileChangeStatus) => {
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

  const renderGroup = (title: string, files: ChangedFile[], group: FileChangeGroup) => {
    if (files.length === 0) return null
    const isExpanded = expandedGroups.has(group)

    return (
      <div key={group}>
        <button
          onClick={() => toggleGroup(group)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-muted/50 transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-foreground">{title}</span>
          <span className="text-[10px] text-muted-foreground">({files.length})</span>
        </button>

        {isExpanded && (
          <div className="space-y-px">
            {files.map((file) => (
              <button
                key={file.id}
                onClick={() => onOpenDiffTab?.(file)}
                className="group w-full flex items-center gap-2 py-1 px-2 pl-6 hover:bg-muted/50 transition-colors text-left"
              >
                <span className={cn("text-[10px] font-mono font-semibold w-3", getStatusColor(file.status))}>
                  {getStatusLabel(file.status)}
                </span>
                <span className="flex-1 text-xs truncate text-muted-foreground group-hover:text-foreground">
                  {file.name}
                </span>
                {(file.additions !== undefined || file.deletions !== undefined) && (
                  <span className="text-[10px] text-muted-foreground/70">
                    {file.additions !== undefined && file.additions > 0 && (
                      <span className="text-status-success">+{file.additions}</span>
                    )}
                    {file.additions !== undefined &&
                      file.deletions !== undefined &&
                      file.additions > 0 &&
                      file.deletions > 0 && <span className="mx-0.5">/</span>}
                    {file.deletions !== undefined && file.deletions > 0 && (
                      <span className="text-status-error">-{file.deletions}</span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="py-1">
      {renderGroup("Committed", committedFiles, "committed")}
      {renderGroup("Staged", stagedFiles, "staged")}
      {renderGroup("Unstaged", unstagedFiles, "unstaged")}

      {mockChangedFiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <GitCompareArrows className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-xs">No changes</span>
        </div>
      )}
    </div>
  )
}

// Context types
interface ContextFile {
  id: string
  name: string
  type: "image" | "document" | "data" | "code" | "text"
  size?: number
  path: string
}

interface ContextFolder {
  id: string
  name: string
  path: string
  children: (ContextFolder | ContextFile)[]
  isExpanded?: boolean
}

type ContextItem = ContextFolder | ContextFile

function isFolder(item: ContextItem): item is ContextFolder {
  return "children" in item
}

const mockContextTree: ContextFolder = {
  id: "root",
  name: "context",
  path: "/context",
  isExpanded: true,
  children: [
    {
      id: "images",
      name: "images",
      path: "/context/images",
      isExpanded: true,
      children: [
        {
          id: "img1",
          name: "screenshot-01.png",
          type: "image",
          size: 245000,
          path: "/context/images/screenshot-01.png",
        },
        {
          id: "img2",
          name: "architecture-diagram.jpg",
          type: "image",
          size: 180000,
          path: "/context/images/architecture-diagram.jpg",
        },
      ],
    },
    {
      id: "docs",
      name: "documents",
      path: "/context/documents",
      isExpanded: false,
      children: [
        {
          id: "doc1",
          name: "requirements.pdf",
          type: "document",
          size: 524000,
          path: "/context/documents/requirements.pdf",
        },
        { id: "doc2", name: "notes.md", type: "text", size: 12000, path: "/context/documents/notes.md" },
      ],
    },
    {
      id: "data",
      name: "data",
      path: "/context/data",
      isExpanded: false,
      children: [
        { id: "data1", name: "test-input.json", type: "data", size: 8500, path: "/context/data/test-input.json" },
        { id: "data2", name: "sample.csv", type: "data", size: 15000, path: "/context/data/sample.csv" },
      ],
    },
    { id: "snippet1", name: "api-example.ts", type: "code", size: 3200, path: "/context/api-example.ts" },
  ],
}

interface ContextPanelProps {
  isDragOver: boolean
}

function ContextPanel({ isDragOver }: ContextPanelProps) {
  const [contextTree, setContextTree] = useState<ContextFolder>(mockContextTree)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleFolder = (folderId: string) => {
    const updateFolder = (folder: ContextFolder): ContextFolder => {
      if (folder.id === folderId) {
        return { ...folder, isExpanded: !folder.isExpanded }
      }
      return {
        ...folder,
        children: folder.children.map((child) => (isFolder(child) ? updateFolder(child) : child)),
      }
    }
    setContextTree(updateFolder(contextTree))
  }

  const toggleSelect = (id: string, event: React.MouseEvent) => {
    const newSelected = new Set(selectedIds)
    if (event.metaKey || event.ctrlKey) {
      if (newSelected.has(id)) {
        newSelected.delete(id)
      } else {
        newSelected.add(id)
      }
    } else {
      newSelected.clear()
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleAddToChat = (item: ContextItem) => {
    console.log("Add to chat:", item.path)
  }

  const handleDelete = (item: ContextItem) => {
    console.log("Delete:", item.path)
  }

  const handleCopyPath = (item: ContextItem) => {
    navigator.clipboard.writeText(item.path)
    console.log("Copied path:", item.path)
  }

  const handleAddContext = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files) {
        console.log(
          "Selected files:",
          Array.from(files).map((f) => f.name),
        )
      }
    }
    input.click()
  }

  return (
    <div className="flex flex-col h-full">
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg m-2 z-10">
          <div className="text-center">
            <Paperclip className="w-8 h-8 text-primary mx-auto mb-2" />
            <span className="text-sm font-medium text-primary">Drop files to add context</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto py-1">
        <ContextTreeNode
          item={contextTree}
          level={0}
          selectedIds={selectedIds}
          onToggleFolder={toggleFolder}
          onSelect={toggleSelect}
          onAddToChat={handleAddToChat}
          onDelete={handleDelete}
          onCopyPath={handleCopyPath}
          isRoot
        />
      </div>

      <div className="p-3">
        <button
          onClick={handleAddContext}
          className="w-full aspect-[3/1] flex flex-col items-center justify-center gap-1.5 border border-dashed border-muted-foreground/30 rounded-lg text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 hover:bg-muted/30 transition-colors"
        >
          <Paperclip className="w-5 h-5" />
          <span className="text-xs">Add more context</span>
        </button>
      </div>
    </div>
  )
}

interface ContextTreeNodeProps {
  item: ContextItem
  level: number
  selectedIds: Set<string>
  onToggleFolder: (id: string) => void
  onSelect: (id: string, event: React.MouseEvent) => void
  onAddToChat: (item: ContextItem) => void
  onDelete: (item: ContextItem) => void
  onCopyPath: (item: ContextItem) => void
  isRoot?: boolean
}

function ContextTreeNode({
  item,
  level,
  selectedIds,
  onToggleFolder,
  onSelect,
  onAddToChat,
  onDelete,
  onCopyPath,
  isRoot,
}: ContextTreeNodeProps) {
  const isSelected = selectedIds.has(item.id)
  const folder = isFolder(item) ? item : null
  const file = !isFolder(item) ? item : null

  const getFileIcon = (type: ContextFile["type"]) => {
    switch (type) {
      case "image":
        return <FileImage className="w-4 h-4 text-status-info" />
      case "document":
        return <FileText className="w-4 h-4 text-status-error" />
      case "data":
        return <FileJson className="w-4 h-4 text-status-warning" />
      case "code":
        return <FileCode className="w-4 h-4 text-status-success" />
      default:
        return <File className="w-4 h-4 text-muted-foreground" />
    }
  }

  if (isRoot && folder) {
    return (
      <>
        {folder.children.map((child) => (
          <ContextTreeNode
            key={child.id}
            item={child}
            level={0}
            selectedIds={selectedIds}
            onToggleFolder={onToggleFolder}
            onSelect={onSelect}
            onAddToChat={onAddToChat}
            onDelete={onDelete}
            onCopyPath={onCopyPath}
          />
        ))}
      </>
    )
  }

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 py-1 px-2 cursor-pointer transition-colors",
          isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={(e) => {
          onSelect(item.id, e)
          if (folder) onToggleFolder(item.id)
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("context-item", JSON.stringify(item))
        }}
      >
        {folder ? (
          <span className="w-4 h-4 flex items-center justify-center">
            {folder.isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
          </span>
        ) : (
          <span className="w-4" />
        )}

        {folder ? (
          folder.isExpanded ? (
            <FolderOpen className="w-4 h-4 text-status-warning" />
          ) : (
            <Folder className="w-4 h-4 text-status-warning" />
          )
        ) : (
          getFileIcon(file!.type)
        )}

        <span className="flex-1 text-xs truncate">{item.name}</span>

        {file && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAddToChat(item)
            }}
            className="p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary rounded transition-all"
            title="Add to chat"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground rounded transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => onCopyPath(item)}>
              <Copy className="w-3.5 h-3.5 mr-2" />
              Copy path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(item)} className="text-destructive focus:text-destructive">
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {folder && folder.isExpanded && (
        <>
          {folder.children.map((child) => (
            <ContextTreeNode
              key={child.id}
              item={child}
              level={level + 1}
              selectedIds={selectedIds}
              onToggleFolder={onToggleFolder}
              onSelect={onSelect}
              onAddToChat={onAddToChat}
              onDelete={onDelete}
              onCopyPath={onCopyPath}
            />
          ))}
        </>
      )}
    </>
  )
}

export type { ChangedFile, FileChangeStatus, FileChangeGroup }
