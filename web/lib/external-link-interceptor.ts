"use client"

import { useEffect } from "react"

import { openExternalUrl } from "./open-external-url"

function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:"
}

function shouldOpenExternally(url: URL): boolean {
  if (!isHttpUrl(url)) return false
  return url.origin !== window.location.origin
}

export function useExternalLinkInterceptor(): void {
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented) return
      if (ev.button !== 0) return
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return

      const target = ev.target
      if (!(target instanceof Element)) return

      const a = target.closest("a[href]") as HTMLAnchorElement | null
      if (!a) return
      if (a.target && a.target !== "_self") return

      const href = a.getAttribute("href")
      if (!href) return
      if (href.startsWith("#")) return

      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }

      if (!shouldOpenExternally(url)) return

      ev.preventDefault()
      void openExternalUrl(url.toString())
    }

    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])
}

