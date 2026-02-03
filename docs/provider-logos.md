# Provider Logos

Luban currently renders provider/agent logos using a single, unified SVG asset.

## Source API

The logo is fetched from:

`https://models.dev/logos/anthropic.svg`

## Local cache

The cached copy lives at:

`web/public/logos/anthropic.svg`

This file is referenced by `web/components/shared/unified-provider-logo.tsx`, which renders the SVG via a CSS mask so
the logo follows `currentColor` in the UI.

## Update the cached asset

Run:

```sh
curl -fsSL https://models.dev/logos/anthropic.svg -o web/public/logos/anthropic.svg
```

## Usage notes

- Any provider logo usage in the UI should use `UnifiedProviderLogo`.
- OpenAI/Anthropic provider branding is intentionally unified to the same cached SVG for now.
