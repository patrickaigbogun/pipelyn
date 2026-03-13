# Pipelyn

Pipelyn is a Bun-first media optimization platform for web and mobile.  
Compress images and videos to modern formats (WebP, H.264) with a single HTTP call or via
the TypeScript SDK.

## Install

Use the public distribution repository for installers and release artifacts.
Set your actual distribution repo path below (example shown as `patrickaigbogun/pipelyn-distribution`).

**Linux / macOS**

```sh
curl -fsSL https://raw.githubusercontent.com/patrickaigbogun/pipelyn-distribution/main/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/patrickaigbogun/pipelyn-distribution/main/install.ps1 | iex
```

Then start the server:

```sh
pipelyn
# → Dex starter running at 0.0.0.0:7990
```

See [Self-hosting docs](https://patrickaigbogun.github.io/pipelyn/docs/self-hosting) for
Docker, Fly.io, and environment variable reference.

---

## SDK

```sh
bun add @pipelyn/sdk
```

```ts
import { createPipelynClient } from '@pipelyn/sdk'

const client = createPipelynClient({ baseUrl: 'http://localhost:7990/api' })
const result = await client.optimizeImage({ media: file })
console.log(`Saved ${result.savedPercent}%`)
```

See [SDK docs](https://patrickaigbogun.github.io/pipelyn/docs/sdk/quickstart) for the full
reference.

---

## What's included

- A self-contained web app with a browser-based optimizer UI and REST API
- A TypeScript SDK (`@pipelyn/sdk`) for Node, Bun, and browser environments
- Async job queue for large video files
- Optional S3/R2/MinIO storage backend
- Optional API-key authentication

## Monorepo Layout

- `apps/web` — Elysia server, optimizer UI, REST API
- `packages/sdk` — TypeScript SDK
- `docs` — FumaDocs documentation site

## Development

```sh
bun install
bun run dev:web          # start dev server
bun run build:web        # production build
bun run build:sdk        # build SDK
bun run check            # type-check all packages
cd packages/sdk && bun test tests   # run SDK tests
```

## Releases

Download pre-built binaries from your public distribution repo releases
(example: [pipelyn-distribution releases](https://github.com/patrickaigbogun/pipelyn-distribution/releases)).
Each release ships self-contained tarballs (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `windows-x64`) — no runtime dependencies required.

To publish a new release:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

The [release workflow](.github/workflows/release.yml) builds and publishes all platform
binaries automatically.

### Private source + public distribution setup

Configure these in your private source repository:

- Repository variable: `PUBLIC_DIST_REPO` (example: `patrickaigbogun/pipelyn-distribution`)
- Repository secret: `PUBLIC_DIST_REPO_TOKEN` (PAT with contents write on the public repo)

With those set:

- `.github/workflows/release.yml` publishes `v*` tag binaries to the public repo's Releases.
- `.github/workflows/sync-public-docs.yml` syncs `README.md`, installers, `.env.example`, and docs markdown to the public repo.
