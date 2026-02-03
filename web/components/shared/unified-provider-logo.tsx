"use client"

import { cn } from "@/lib/utils"

function providerLogoUrl(providerId: string): string {
  return `/logos/${encodeURIComponent(providerId)}.svg`
}

export function UnifiedProviderLogo({
  providerId,
  className,
  label = "Provider",
  decorative = true,
}: {
  providerId: string
  className?: string
  label?: string
  decorative?: boolean
}) {
  const logoUrl = providerLogoUrl(providerId)

  return (
    <span
      data-provider-id={providerId}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      className={cn("inline-block bg-current", className)}
      style={{
        WebkitMaskImage: `url(${logoUrl})`,
        maskImage: `url(${logoUrl})`,
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
