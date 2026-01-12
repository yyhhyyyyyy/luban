"use client"

import type { ElementType } from "react"

import { useRef, useState } from "react"
import { useTheme } from "next-themes"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
  Type,
  X,
} from "lucide-react"

import { useAppearance } from "@/components/appearance-provider"
import { cn } from "@/lib/utils"

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
]

const themeOptions = [
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

function ThemePreviewCard({
  themeId,
  label,
  icon: Icon,
  isSelected,
  onClick,
}: {
  themeId: string
  label: string
  icon: ElementType
  isSelected: boolean
  onClick: () => void
}) {
  const isSystem = themeId === "system"
  const colors = themeColors[themeId as keyof typeof themeColors] || themeColors.light

  return (
    <button
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
}: {
  value: string
  onChange: (value: string) => void
  fonts: string[]
  mono?: boolean
  label: string
  vertical?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn("relative", vertical ? "flex flex-col gap-1" : "inline-flex items-center gap-1.5")}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <button
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
          <div className="absolute top-full left-0 mt-1.5 z-50 bg-popover border border-border rounded-lg shadow-xl max-h-52 w-44 overflow-y-auto">
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
              <InlineFontSelect label="UI Font" value={uiFont} onChange={setUiFont} fonts={mockLocalFonts} vertical />
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
                  <InlineFontSelect label="Chat Font" value={chatFont} onChange={setChatFont} fonts={mockLocalFonts} />
                </div>
                <div className="bg-secondary/50 border border-border rounded-lg p-3" style={{ fontFamily: `"${chatFont}", sans-serif` }}>
                  <p className="text-sm leading-relaxed text-muted-foreground">The quick brown fox jumps over the lazy dog</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="pointer-events-auto">
                  <InlineFontSelect label="Code Font" value={monoFont} onChange={setMonoFont} fonts={mockMonoFonts} mono />
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

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const { fonts, setFonts } = useAppearance()
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
              onClick={() => setTheme(option.id)}
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
          setUiFont={(uiFont) => setFonts({ uiFont })}
          setChatFont={(chatFont) => setFonts({ chatFont })}
          setMonoFont={(codeFont) => setFonts({ codeFont })}
          setTerminalFont={(terminalFont) => setFonts({ terminalFont })}
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
            const isExpanded = expandedItems.has(item.id)
            const hasChildren = !!item.children?.length

            return (
              <div key={item.id}>
                <div className="flex items-center hover:bg-sidebar-accent/50 transition-colors">
                  <button onClick={() => hasChildren && toggleExpanded(item.id)} className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left">
                    {hasChildren ? (
                      isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      )
                    ) : (
                      <div className="w-3 h-3" />
                    )}
                    <span className="text-sm text-muted-foreground truncate flex-1">{item.label}</span>
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
            <AppearanceSettings />
          </div>
        </div>
      </div>
    </div>
  )
}

