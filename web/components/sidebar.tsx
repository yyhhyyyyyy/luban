"use client"

import type React from "react"

import {
  ChevronDown,
  ChevronRight,
  Plus,
  Settings,
  LayoutGrid,
  Sparkles,
  Layers,
  Archive,
  Loader2,
  Home,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useLuban } from "@/lib/luban-context"
import type { SidebarProjectVm, SidebarWorktreeVm } from "@/lib/sidebar-view-model"
import { buildSidebarProjects } from "@/lib/sidebar-view-model"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { NewTaskModal } from "./new-task-modal"
import { AgentStatusIcon, PRBadge } from "./shared/status-indicator"
import { focusChatInput } from "@/lib/focus-chat-input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SettingsPanel } from "@/components/settings-panel"
import type { AgentStatus } from "@/lib/worktree-ui"
import type { SettingsSectionId } from "@/lib/open-settings"
import type { WorkspaceId } from "@/lib/luban-api"

interface SidebarProps {
  viewMode: "workspace" | "kanban"
  onViewModeChange: (mode: "workspace" | "kanban") => void
  widthPx: number
}

function normalizePathLike(raw: string): string {
  return raw.trim().replace(/\/+$/, "")
}

export function Sidebar({ viewMode, onViewModeChange, widthPx }: SidebarProps) {
  const {
    app,
    activeWorkspaceId,
    createWorkspace,
    openWorkspacePullRequest,
    openWorkspacePullRequestFailedAction,
    archiveWorkspace,
    toggleProjectExpanded,
    openWorkspace,
    addProject,
    ensureMainWorkspace,
    pickProjectPath,
    deleteProject,
  } = useLuban()

  const pendingCreateRef = useRef<{ projectId: number; existingWorkspaceIds: Set<number> } | null>(null)
  const pendingAddProjectPathRef = useRef<string | null>(null)
  const pendingAddProjectAndOpenPathRef = useRef<string | null>(null)
  const ensuringMainWorkspaceForProjectIdsRef = useRef<Set<number>>(new Set())
  const [optimisticCreatingProjectId, setOptimisticCreatingProjectId] = useState<number | null>(null)
  const [newlyCreatedWorkspaceId, setNewlyCreatedWorkspaceId] = useState<number | null>(null)
  const [optimisticArchivingWorkspaceIds, setOptimisticArchivingWorkspaceIds] = useState<Set<number>>(
    () => new Set(),
  )
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null)
  const [projectToDelete, setProjectToDelete] = useState<{ id: number; name: string } | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialSectionId, setSettingsInitialSectionId] = useState<SettingsSectionId | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sectionId?: SettingsSectionId } | null>).detail
      setSettingsInitialSectionId(detail?.sectionId ?? "agent")
      setSettingsOpen(true)
    }
    window.addEventListener("luban:open-settings", handler)
    return () => window.removeEventListener("luban:open-settings", handler)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string } | null>).detail
      const path = detail?.path?.trim()
      if (!path) return
      pendingAddProjectAndOpenPathRef.current = path
      addProject(path)
      setSettingsOpen(false)
      setSettingsInitialSectionId(null)
      onViewModeChange("workspace")
    }
    window.addEventListener("luban:add-project-and-open", handler)
    return () => window.removeEventListener("luban:add-project-and-open", handler)
  }, [addProject, onViewModeChange])

  useEffect(() => {
    if (!app) return

    setOptimisticArchivingWorkspaceIds((prev) => {
      if (prev.size === 0) return prev

      const activeById = new Map<number, "idle" | "running">()
      for (const project of app.projects) {
        for (const workspace of project.workspaces) {
          if (workspace.status !== "active") continue
          activeById.set(workspace.id, workspace.archive_status)
        }
      }

      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        const status = activeById.get(id)
        if (!status) {
          changed = true
          continue
        }
        if (status !== "running") {
          changed = true
          continue
        }
        next.add(id)
      }
      return changed ? next : prev
    })

    if (deletingProjectId != null) {
      const stillExists = app.projects.some((p) => p.id === deletingProjectId)
      if (!stillExists) {
        setDeletingProjectId(null)
      }
    }

    const pendingProjectPath = pendingAddProjectPathRef.current
    if (pendingProjectPath) {
      const match = app.projects.find(
        (p) => normalizePathLike(p.path) === normalizePathLike(pendingProjectPath),
      )
      if (match) {
        pendingAddProjectPathRef.current = null

        if (!match.expanded) {
          toggleProjectExpanded(match.id)
        }

        const main =
          match.workspaces.find((w) => w.workspace_name === "main" && w.worktree_path === match.path) ??
          match.workspaces[0] ??
          null
        if (main) {
          void openWorkspace(main.id).then(() => focusChatInput())
        }
      }
    }

    const pendingOpenPath = pendingAddProjectAndOpenPathRef.current
    if (pendingOpenPath) {
      const match = app.projects.find((p) => normalizePathLike(p.path) === normalizePathLike(pendingOpenPath))
      if (match) {
        const activeWorkspaces = match.workspaces.filter((w) => w.status === "active")
        if (activeWorkspaces.length === 0) {
          if (!ensuringMainWorkspaceForProjectIdsRef.current.has(match.id)) {
            ensuringMainWorkspaceForProjectIdsRef.current.add(match.id)
            ensureMainWorkspace(match.id)
          }
          return
        }

        ensuringMainWorkspaceForProjectIdsRef.current.delete(match.id)
        pendingAddProjectAndOpenPathRef.current = null

        if (!match.expanded) {
          toggleProjectExpanded(match.id)
        }

        const main =
          activeWorkspaces.find((w) => w.workspace_name === "main" && w.worktree_path === match.path) ??
          activeWorkspaces[0] ??
          null
        if (!main) return

        void openWorkspace(main.id as WorkspaceId).then(() => focusChatInput())
      }
    }

    if (optimisticCreatingProjectId != null) {
      const confirmed = app.projects.some(
        (p) => p.id === optimisticCreatingProjectId && p.create_workspace_status === "running",
      )
      if (confirmed) {
        setOptimisticCreatingProjectId(null)
      }
    }

    const pending = pendingCreateRef.current
    if (pending) {
      const pendingProject = app.projects.find((p) => p.id === pending.projectId)
      if (pendingProject?.create_workspace_status === "running") {
        return
      }

      pendingCreateRef.current = null
      setOptimisticCreatingProjectId(null)

      const created = pendingProject?.workspaces.find((w) => !pending.existingWorkspaceIds.has(w.id))?.id
      if (created == null) return

      setNewlyCreatedWorkspaceId(created)
      void openWorkspace(created).then(() => focusChatInput())
      const t = window.setTimeout(() => setNewlyCreatedWorkspaceId(null), 1500)
      return () => window.clearTimeout(t)
    }

    const running = app.projects.find((p) => p.create_workspace_status === "running")
    if (!running) return
    pendingCreateRef.current = {
      projectId: running.id,
      existingWorkspaceIds: new Set(running.workspaces.map((w) => w.id)),
    }
  }, [app?.rev])

  const projects: SidebarProjectVm[] = buildSidebarProjects(app, { optimisticArchivingWorkspaceIds })

  const getActiveWorktreeCount = (worktrees: SidebarWorktreeVm[]) => {
    return worktrees.filter((w) => w.agentStatus !== "idle" || w.prStatus !== "none").length
  }

  const deriveStandaloneProjectStatus = (args: { isCreating: boolean; isGit: boolean }): AgentStatus | null => {
    if (!args.isGit) return "idle"
    if (args.isCreating) return "running"
    return "idle"
  }

  const handleAddProjectClick = async () => {
    try {
      const picked = await pickProjectPath()
      if (!picked) return
      pendingAddProjectPathRef.current = picked
      addProject(picked)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const confirmDeleteProject = () => {
    if (!projectToDelete) return
    const projectId = projectToDelete.id
    setProjectToDelete(null)
    setDeletingProjectId(projectId)
    deleteProject(projectId)

    window.setTimeout(() => {
      setDeletingProjectId((prev) => (prev === projectId ? null : prev))
    }, 30_000)
  }

  return (
    <aside
      data-testid="left-sidebar"
      className="flex-shrink-0 border-r border-border bg-sidebar flex flex-col overflow-x-hidden"
      style={{ width: `${widthPx}px` }}
    >
      <div className="flex items-center justify-between h-11 px-3 border-b border-border">
        <button
          onClick={() => onViewModeChange(viewMode === "workspace" ? "kanban" : "workspace")}
          className="flex items-center gap-2 hover:bg-sidebar-accent px-1.5 py-1 rounded transition-colors"
        >
          <div className="flex items-center justify-center w-6 h-6 rounded bg-secondary">
            {viewMode === "workspace" ? (
              <Layers className="w-3.5 h-3.5 text-foreground" />
            ) : (
              <LayoutGrid className="w-3.5 h-3.5 text-foreground" />
            )}
          </div>
          <span className="text-sm font-medium">{viewMode === "workspace" ? "Workspace" : "Kanban"}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>

      {/* Project List */}
      <div
        data-testid="left-sidebar-scroll"
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-1.5"
      >
        {projects.map((project) => {
          const activeCount = getActiveWorktreeCount(project.worktrees)
          const isCreating =
            project.createWorkspaceStatus === "running" || optimisticCreatingProjectId === project.id
          const isDeleting = deletingProjectId === project.id
          const standaloneMainWorktree =
            project.isGit && project.worktrees.length === 1 && project.worktrees[0]?.isHome
              ? project.worktrees[0]
              : null
          const canExpand = project.isGit && project.worktrees.length > 1
          const isExpanded = canExpand && project.expanded
          const standaloneStatus = canExpand
            ? null
            : standaloneMainWorktree?.agentStatus ??
              deriveStandaloneProjectStatus({ isCreating, isGit: project.isGit })
          const isStandaloneMainActive =
            standaloneMainWorktree != null && standaloneMainWorktree.workspaceId === activeWorkspaceId
          return (
            <div
              key={project.id}
              className={cn("group/project", isDeleting && "animate-pulse opacity-50 pointer-events-none")}
            >
              <div
                className={cn(
                  "flex items-center hover:bg-sidebar-accent/50 transition-colors",
                  isStandaloneMainActive && "bg-sidebar-accent/30",
                )}
              >
                <button
                  data-testid={standaloneMainWorktree ? "project-main-only-entry" : undefined}
                  onClick={() => {
                    if (canExpand) {
                      toggleProjectExpanded(project.id)
                      return
                    }
                    if (standaloneMainWorktree) {
                      void openWorkspace(standaloneMainWorktree.workspaceId)
                    }
                  }}
                  className={cn(
                    "flex-1 flex items-center gap-2 px-3 py-1.5 text-left",
                    !canExpand && !standaloneMainWorktree && "cursor-default",
                  )}
                >
                  {canExpand ? (
                    isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    )
                  ) : standaloneStatus ? (
                    <span data-testid="project-agent-status-icon">
                      <AgentStatusIcon status={standaloneStatus} size="xs" />
                    </span>
                  ) : (
                    <span className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className="text-sm text-muted-foreground truncate flex-1" title={project.name}>
                    {project.name}
                  </span>
                  {canExpand && !isExpanded && activeCount > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
                      {activeCount}
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover/project:opacity-100 transition-opacity">
                  {project.isGit && (
                    <button
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      title="Add worktree"
                      onClick={() => {
                        if (isCreating) return
                        if (!project.expanded) {
                        toggleProjectExpanded(project.id)
                      }
                      const fullProject = app?.projects.find((p) => p.id === project.id) ?? null
                      const existingWorkspaceIds = new Set<number>(
                          fullProject?.workspaces.map((w) => w.id) ?? project.worktrees.map((w) => w.workspaceId),
                        )
                        pendingCreateRef.current = { projectId: project.id, existingWorkspaceIds }
                        setOptimisticCreatingProjectId(project.id)
                      createWorkspace(project.id)
                    }}
                    disabled={isCreating}
                  >
                      {isCreating ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <button
                    data-testid="project-delete-button"
                    onClick={() => setProjectToDelete({ id: project.id, name: project.name })}
                    disabled={isDeleting}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete project"
                  >
                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="ml-4 pl-3 border-l border-border-subtle">
                  {project.worktrees.map((worktree, idx) => (
                    <div
                      key={worktree.workspaceId}
                      className={cn(
                        "group/worktree flex items-center gap-2 px-2 py-1.5 hover:bg-sidebar-accent/30 transition-all cursor-pointer rounded mx-1",
                        worktree.workspaceId === activeWorkspaceId && "bg-sidebar-accent/30",
                        newlyCreatedWorkspaceId === worktree.workspaceId &&
                          "animate-in slide-in-from-left-2 fade-in duration-300 ring-1 ring-primary/30",
                        worktree.isArchiving && "animate-pulse opacity-50 pointer-events-none",
                      )}
                      style={{
                        animationDelay:
                          newlyCreatedWorkspaceId === worktree.workspaceId ? "0ms" : `${idx * 30}ms`,
                      }}
                      onClick={() => {
                        void openWorkspace(worktree.workspaceId)
                      }}
                    >
                        {worktree.isArchiving ? (
                          <Loader2
                            data-testid="worktree-archiving-spinner"
                            className="w-3.5 h-3.5 animate-spin text-muted-foreground"
                          />
                        ) : (
                          <AgentStatusIcon status={worktree.agentStatus} size="sm" />
                        )}

                        <div className="flex flex-col flex-1 min-w-0">
                          <span
                            data-testid="worktree-branch-name"
                            className="text-xs text-foreground truncate"
                            title={worktree.name}
                          >
                            {worktree.name}
                          </span>
                          <span data-testid="worktree-short-id" className="text-[10px] text-muted-foreground/50 font-mono">
                            {worktree.id}
                          </span>
                        </div>

                        <PRBadge
                          status={worktree.prStatus}
                          prNumber={worktree.prNumber}
                          workspaceId={worktree.workspaceId}
                          onOpenPullRequest={openWorkspacePullRequest}
                          onOpenPullRequestFailedAction={openWorkspacePullRequestFailedAction}
                          titleOverride={worktree.prTitle}
                        />
                      {/* Archive button only for non-home worktrees */}
                      {worktree.isHome ? (
                        <span
                          data-testid="worktree-home-icon"
                          className="p-0.5 text-muted-foreground/50 opacity-0 group-hover/worktree:opacity-100 transition-opacity"
                          title="Main worktree"
                        >
                          <Home className="w-3 h-3" />
                        </span>
                      ) : (
                        <button
                          className={cn(
                            "p-0.5 text-muted-foreground hover:text-foreground transition-opacity",
                            worktree.isArchiving
                              ? "opacity-50"
                              : "opacity-0 group-hover/worktree:opacity-100",
                          )}
                          title="Archive worktree"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOptimisticArchivingWorkspaceIds((prev) => {
                              const next = new Set(prev)
                              next.add(worktree.workspaceId)
                              return next
                            })
                            archiveWorkspace(worktree.workspaceId)
                          }}
                          disabled={worktree.isArchiving}
                        >
	                          <Archive className="w-3 h-3" />
	                        </button>
	                      )}
                    </div>
                  ))}

                  {isCreating && (
                    <div className="flex items-center gap-2 px-2 py-1.5 mx-1 animate-pulse">
                      <div className="flex flex-col flex-1 gap-1">
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded bg-muted-foreground/20" />
                          <div className="h-3 w-20 rounded bg-muted-foreground/20" />
                        </div>
                        <div className="h-2.5 w-8 ml-4 rounded bg-muted-foreground/15" />
                      </div>
                    </div>
                  )}
                </div>
              )}
	            </div>
	          )
	        })}

        <button
          onClick={() => void handleAddProjectClick()}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-muted-foreground/60 hover:text-muted-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <Plus className="w-3 h-3 flex-shrink-0" />
          <span className="text-[13px]">Add project</span>
        </button>
      </div>

      {/* Bottom Actions */}
      <div className="border-t border-border p-2 flex items-center gap-2">
        <button
          onClick={() => setNewTaskOpen(true)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded transition-colors"
        >
          <Sparkles className="w-4 h-4 text-primary" />
          New Task
        </button>
        <button
          data-testid="sidebar-open-settings"
          onClick={() => setSettingsOpen(true)}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <NewTaskModal open={newTaskOpen} onOpenChange={setNewTaskOpen} />
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open)
          if (!open) setSettingsInitialSectionId(null)
        }}
        initialSectionId={settingsInitialSectionId ?? undefined}
      />

      <Dialog open={projectToDelete !== null} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <DialogContent
          data-testid="project-delete-dialog"
          showCloseButton={false}
          className="sm:max-w-[400px] p-0 gap-0 bg-background border-border overflow-hidden rounded-lg"
        >
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-base font-medium flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" />
              Delete Project
            </h2>
          </div>

          <div className="p-5">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">&quot;{projectToDelete?.name ?? ""}&quot;</span>? This action
              cannot be undone.
            </p>
          </div>

          <div className="px-5 py-4 border-t border-border bg-secondary/30 flex items-center justify-end gap-2">
            <Button
              data-testid="project-delete-cancel"
              variant="outline"
              size="sm"
              onClick={() => setProjectToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              data-testid="project-delete-confirm"
              variant="destructive"
              size="sm"
              onClick={confirmDeleteProject}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
