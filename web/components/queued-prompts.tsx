"use client"

import type React from "react"

import { Check, Paperclip, Pencil, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { CodexAgentSelector } from "@/components/shared/agent-selector"
import { MessageEditor, type ComposerAttachment } from "@/components/shared/message-editor"
import type {
  AttachmentRef,
  CodexCustomPromptSnapshot,
  QueuedPromptSnapshot,
  ThinkingEffort,
} from "@/lib/luban-api"

export function QueuedPromptRow({
  prompt,
  isEditing,
  isDragging,
  workspaceId,
  commands,
  messageHistory,
  editingText,
  editingAttachments,
  editingModelId,
  editingThinkingEffort,
  defaultModelId,
  defaultThinkingEffort,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onCancelPrompt,
  onEditingTextChange,
  onEditingModelIdChange,
  onEditingThinkingEffortChange,
  onQueuedFileSelect,
  onQueuedPaste,
  onRemoveEditingAttachment,
  onAddEditingAttachmentRef,
  onOpenAgentSettings,
  onQueueDragStart,
  onQueueDragEnd,
  onQueueDrop,
}: {
  prompt: QueuedPromptSnapshot
  isEditing: boolean
  isDragging: boolean
  workspaceId: number | null
  commands: CodexCustomPromptSnapshot[]
  messageHistory: string[]
  editingText: string
  editingAttachments: ComposerAttachment[]
  editingModelId: string | null
  editingThinkingEffort: ThinkingEffort | null
  defaultModelId: string | null
  defaultThinkingEffort: ThinkingEffort | null
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onCancelPrompt: () => void
  onEditingTextChange: (text: string) => void
  onEditingModelIdChange: (modelId: string) => void
  onEditingThinkingEffortChange: (effort: ThinkingEffort) => void
  onQueuedFileSelect: (files: FileList | null) => void
  onQueuedPaste: (e: React.ClipboardEvent) => void
  onRemoveEditingAttachment: (id: string) => void
  onAddEditingAttachmentRef: (attachment: AttachmentRef) => void
  onOpenAgentSettings: (agentId: string, agentFilePath?: string) => void
  onQueueDragStart: () => void
  onQueueDragEnd: () => void
  onQueueDrop: (activeId: number, overId: number) => void
}) {
  if (isEditing) {
    const hasUploading = editingAttachments.some((a) => a.status === "uploading")
    const hasReady = editingAttachments.some((a) => a.status === "ready" && a.attachment != null)
    const canSave = !hasUploading && (editingText.trim().length > 0 || hasReady)

    return (
      <div className="transition-all duration-200 ease-out">
        <MessageEditor
          value={editingText}
          onChange={onEditingTextChange}
          attachments={editingAttachments}
          onRemoveAttachment={onRemoveEditingAttachment}
          onFileSelect={onQueuedFileSelect}
          onPaste={onQueuedPaste}
          onAddAttachmentRef={onAddEditingAttachmentRef}
          workspaceId={workspaceId}
          commands={commands}
          messageHistory={messageHistory}
          onCommand={(commandId) => {
            const match = commands.find((p) => p.id === commandId) ?? null
            if (!match) return
            onEditingTextChange(match.contents)
          }}
          placeholder="Edit message..."
          disabled={false}
          autoFocus
          agentSelector={
            <CodexAgentSelector
              testId="queued-codex-agent-selector"
              dropdownPosition="top"
              modelId={editingModelId}
              thinkingEffort={editingThinkingEffort}
              defaultModelId={defaultModelId}
              defaultThinkingEffort={defaultThinkingEffort}
              onOpenAgentSettings={onOpenAgentSettings}
              onChangeModelId={onEditingModelIdChange}
              onChangeThinkingEffort={onEditingThinkingEffortChange}
            />
          }
          secondaryAction={{
            onClick: onCancelEdit,
            ariaLabel: "Cancel edit",
            icon: <X className="w-3.5 h-3.5" />,
          }}
          primaryAction={{
            onClick: () => {
              if (!canSave) return
              onSaveEdit()
            },
            disabled: !canSave,
            ariaLabel: "Save message",
            icon: <Check className="w-3.5 h-3.5" />,
            testId: "queued-save",
          }}
          testIds={{
            textInput: "queued-prompt-input",
            attachInput: "queued-attach-input",
            attachButton: "queued-attach",
            attachmentTile: "queued-attachment-tile",
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={cn("group flex justify-end transition-all duration-200", isDragging && "z-50 opacity-90")}
      data-testid="queued-prompt-item"
      data-prompt-id={prompt.id}
    >
      <div
        className={cn(
          "relative max-w-[85%] border border-dashed border-border rounded-lg px-3 py-2.5 bg-muted/30 luban-font-chat transition-all duration-200",
          isDragging && "shadow-lg border-primary/30 bg-background",
        )}
        onDoubleClick={() => onStartEdit()}
        data-testid="queued-prompt-bubble"
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", String(prompt.id))
          e.dataTransfer.effectAllowed = "move"
          onQueueDragStart()
        }}
        onDragEnd={() => onQueueDragEnd()}
        onDragOver={(e) => {
          e.preventDefault()
        }}
        onDrop={(e) => {
          e.preventDefault()
          const raw = e.dataTransfer.getData("text/plain")
          const activeId = Number(raw)
          if (!Number.isFinite(activeId)) return
          onQueueDrop(activeId, prompt.id)
        }}
      >
        {!isDragging && (
          <div className="absolute -top-1.5 -right-1.5 flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onStartEdit()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 bg-background border border-border rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted hover:border-border hover:text-foreground"
              aria-label="Edit queued message"
              data-testid="queued-prompt-edit"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCancelPrompt()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 bg-background border border-border rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:border-destructive hover:text-destructive-foreground"
              aria-label="Remove queued message"
              data-testid="queued-prompt-cancel"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {prompt.attachments && prompt.attachments.length > 0 && (
          <div className="flex items-center gap-1 mb-1 text-[10px] text-muted-foreground">
            <Paperclip className="w-3 h-3" />
            {prompt.attachments.length} file{prompt.attachments.length > 1 ? "s" : ""}
          </div>
        )}

        <div className="text-[13px] text-foreground whitespace-pre-wrap break-words cursor-grab active:cursor-grabbing">
          {prompt.text}
        </div>
      </div>
    </div>
  )
}
