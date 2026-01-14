"use client"

export function addProjectAndOpen(path: string): void {
  window.dispatchEvent(new CustomEvent("luban:add-project-and-open", { detail: { path } }))
}

