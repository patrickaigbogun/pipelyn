# Pipelyn

Pipelyn is a Bun-first media optimization platform for web and mobile.

It provides:

- A Dex-powered web app for upload, optimization, and delivery workflows.
- A Bun SDK for integrating media optimization into existing products.
- A dedicated docs site powered by FumaDocs.

## Monorepo Layout

- `apps/web`: Dex app (UI + API runtime)
- `packages/sdk`: Bun-first TypeScript SDK
- `docs`: FumaDocs documentation site

## Quick Commands

- `bun run dev:web`: run the Dex app in development
- `bun run build:web`: build the Dex app
- `bun run build:sdk`: build the SDK package
- `bun run check`: type-check web and SDK projects
