# Provider Logos

Luban renders provider/agent logos using cached SVG assets keyed by Provider ID.

## Source API

Logos are fetched from:

`https://models.dev/logos/{provider}.svg`

Where `{provider}` is the Provider ID.

Note: Luban does not fetch these URLs at runtime. Logos are served from `web/public/logos/`.

## Local cache

Cached copies live at:

`web/public/logos/{provider}.svg`

These files are referenced by `web/components/shared/unified-provider-logo.tsx`, which renders the SVG via a CSS mask
so the logo follows `currentColor` in the UI.

## Update the cached asset

Run:

```sh
curl -fsSL https://models.dev/logos/openai.svg -o web/public/logos/openai.svg
curl -fsSL https://models.dev/logos/anthropic.svg -o web/public/logos/anthropic.svg
curl -fsSL https://ampcode.com/press-kit/mark-color.svg -o web/public/logos/amp.svg
```

## Usage notes

- Any provider logo usage in the UI should use `UnifiedProviderLogo` with a `providerId`.
