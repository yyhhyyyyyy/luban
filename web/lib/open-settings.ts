"use client"

export type SettingsSectionId = "theme" | "fonts" | "agent" | "task"

export type OpenSettingsDetail = {
  sectionId?: SettingsSectionId
  agentId?: string
  agentFilePath?: string
}

export function openSettingsPanel(
  sectionId: SettingsSectionId = "agent",
  opts?: { agentId?: string; agentFilePath?: string },
): void {
  window.dispatchEvent(
    new CustomEvent("luban:open-settings", { detail: { sectionId, ...opts } satisfies OpenSettingsDetail }),
  )
}
