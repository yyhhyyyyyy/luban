"use client"

import { cn } from "@/lib/utils"

const UNIFIED_PROVIDER_LOGO_URL = "/logos/anthropic.svg"

export function UnifiedProviderLogo({
  className,
  label = "Provider",
  decorative = true,
}: {
  className?: string
  label?: string
  decorative?: boolean
}) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={cn("inline-block bg-current", className)}
      style={{
        WebkitMaskImage: `url(${UNIFIED_PROVIDER_LOGO_URL})`,
        maskImage: `url(${UNIFIED_PROVIDER_LOGO_URL})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  )
}
