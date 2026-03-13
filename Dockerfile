# ─────────────────────────────────────────────────────────────────────────────
# Pipelyn — Docker build
# Builds the apps/web server using the official Bun image.
#
#   docker build -t pipelyn .
#   docker run -p 7990:7990 --env-file .env pipelyn
# ─────────────────────────────────────────────────────────────────────────────

FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json bun.lockb* ./
COPY packages/sdk/package.json packages/sdk/
COPY apps/web/package.json apps/web/

# Install all workspace deps
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build SDK (web app may depend on it at build time)
RUN cd packages/sdk && bun run build

# Build web assets (Tailwind + React)
RUN cd apps/web && bun run build

# ─────────────────────────────────────────────────────────────────────────────

FROM oven/bun:1-slim AS runtime

# ffmpeg is required for video optimisation
RUN apt-get update && apt-get install --no-install-recommends -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only bring in what's needed to run the server
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lockb* ./
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/

# Re-install production deps only (no devDependencies)
RUN bun install --frozen-lockfile --production

ENV NODE_ENV=production
ENV PORT=7990

EXPOSE 7990

CMD ["bun", "run", "apps/web/core/runtime/server/prod.ts"]
