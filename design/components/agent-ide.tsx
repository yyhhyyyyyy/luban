"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { ChatPanel } from "./chat-panel"
import { RightSidebar, type ChangedFile } from "./right-sidebar"
import { KanbanBoard } from "./kanban-board"

export function AgentIDE() {
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const [viewMode, setViewMode] = useState<"workspace" | "kanban">("workspace")
  const [pendingDiffFile, setPendingDiffFile] = useState<ChangedFile | null>(null)

  const handleOpenDiffTab = (file: ChangedFile) => {
    setPendingDiffFile(file)
  }

  const handleDiffFileOpened = () => {
    setPendingDiffFile(null)
  }

  return (
    <div className="relative flex h-screen bg-background text-foreground overflow-hidden">
      {viewMode === "workspace" && (
        <>
          <Sidebar viewMode={viewMode} onViewModeChange={setViewMode} />
          <ChatPanel pendingDiffFile={pendingDiffFile} onDiffFileOpened={handleDiffFileOpened} />
          <RightSidebar
            isOpen={rightSidebarOpen}
            onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
            onOpenDiffTab={handleOpenDiffTab}
          />
        </>
      )}

      {viewMode === "kanban" && <KanbanBoard onViewModeChange={setViewMode} />}
    </div>
  )
}
