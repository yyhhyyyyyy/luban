"use client"

import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TaskStatus } from "@/lib/luban-api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Tabler icon classes mapped to task statuses
// Using percentage-based progress icons for in-progress states
export const taskStatusConfig: Record<
  TaskStatus,
  {
    label: string
    color: string
    iconClass: string
  }
> = {
  backlog: {
    label: "Backlog",
    color: "#525252",
    iconClass: "icon-[tabler--circle-dashed]",
  },
  todo: {
    label: "Todo",
    color: "#6b6b6b",
    iconClass: "icon-[tabler--circle]",
  },
  iterating: {
    label: "Iterating",
    color: "#f2994a",
    iconClass: "icon-[tabler--percentage-50]",
  },
  validating: {
    label: "Validating",
    color: "#5e6ad2",
    iconClass: "icon-[tabler--percentage-75]",
  },
  done: {
    label: "Done",
    color: "#27ae60",
    iconClass: "icon-[tabler--circle-check-filled]",
  },
  canceled: {
    label: "Canceled",
    color: "#9b9b9b",
    iconClass: "icon-[tabler--circle-x]",
  },
}

export const taskStatuses = Object.entries(taskStatusConfig).map(([id, config]) => ({
  id: id as TaskStatus,
  ...config,
}))

interface TaskStatusIconProps {
  status: TaskStatus
  size?: "xs" | "sm" | "md"
  className?: string
}

export function TaskStatusIcon({ status, size = "sm", className }: TaskStatusIconProps) {
  const config = taskStatusConfig[status]
  const sizeClass = size === "xs" ? "w-3.5 h-3.5" : size === "sm" ? "w-4 h-4" : "w-5 h-5"

  return (
    <span
      className={cn("relative flex items-center justify-center flex-shrink-0", sizeClass, className)}
      style={{ color: config.color }}
    >
      <span className={cn(config.iconClass, "w-full h-full")} />
    </span>
  )
}

interface TaskStatusSelectorProps {
  status: TaskStatus
  onStatusChange?: (status: TaskStatus) => void
  size?: "sm" | "md"
  disabled?: boolean
  triggerTestId?: string
  variant?: "icon" | "pill"
}

export function TaskStatusSelector({
  status,
  onStatusChange,
  size = "sm",
  disabled = false,
  triggerTestId,
  variant = "icon",
}: TaskStatusSelectorProps) {
  const currentConfig = taskStatusConfig[status]

  const buttonSize = size === "sm" ? "w-6 h-6" : "w-7 h-7"
  const pillHeightClass = size === "sm" ? "h-[26px]" : "h-[28px]"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "pill" ? (
          <button
            disabled={disabled}
            data-testid={triggerTestId ?? "task-status-trigger"}
            className={cn(
              "flex items-center gap-1.5 px-2 rounded-[7px] border transition-colors",
              "hover:bg-[#f7f7f7]",
              disabled && "opacity-50 cursor-not-allowed",
              pillHeightClass,
            )}
            style={{ borderColor: "#ebebeb", color: "#1b1b1b" }}
            title={`Status: ${currentConfig.label}`}
          >
            <TaskStatusIcon status={status} size="xs" />
            <span className="text-[12px] font-medium">{currentConfig.label}</span>
            <ChevronDown className="w-3.5 h-3.5" style={{ color: "#9b9b9b" }} />
          </button>
        ) : (
          <button
            disabled={disabled}
            data-testid={triggerTestId ?? "task-status-trigger"}
            className={cn(
              "flex items-center justify-center rounded hover:bg-muted transition-colors",
              disabled && "opacity-50 cursor-not-allowed",
              buttonSize,
            )}
            title={`Status: ${currentConfig.label}`}
          >
            <TaskStatusIcon status={status} size={size === "sm" ? "sm" : "md"} />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40 p-1.5" data-testid="task-status-menu">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Change status...
        </div>
        {taskStatuses.map((s) => {
          const isSelected = s.id === status
          return (
            <DropdownMenuItem
              key={s.id}
              data-testid={`task-status-option-${s.id}`}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 cursor-pointer",
                isSelected && "bg-accent"
              )}
              onSelect={() => {
                if (s.id !== status) {
                  onStatusChange?.(s.id)
                }
              }}
            >
              <span
                className={cn(s.iconClass, "w-[14px] h-[14px] flex-shrink-0")}
                style={{ color: s.color }}
              />
              <span className="flex-1 text-[13px]">{s.label}</span>
              {isSelected && <Check className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
