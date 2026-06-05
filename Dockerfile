# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Install all dependencies (including devDependencies for build)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches/
RUN pnpm install --frozen-lockfile

# Build frontend (Vite) and backend (esbuild)
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Vite embeds VITE_* variables at build time.
# Pass these via --build-arg when building the image (e.g. Cloud Build substitutions).
ARG VITE_OWNER_OPEN_ID
ARG VITE_FRONTEND_FORGE_API_KEY
ARG VITE_FRONTEND_FORGE_API_URL
ARG VITE_ANALYTICS_ENDPOINT
ARG VITE_ANALYTICS_WEBSITE_ID
ENV VITE_OWNER_OPEN_ID=$VITE_OWNER_OPEN_ID \
    VITE_FRONTEND_FORGE_API_KEY=$VITE_FRONTEND_FORGE_API_KEY \
    VITE_FRONTEND_FORGE_API_URL=$VITE_FRONTEND_FORGE_API_URL \
    VITE_ANALYTICS_ENDPOINT=$VITE_ANALYTICS_ENDPOINT \
    VITE_ANALYTICS_WEBSITE_ID=$VITE_ANALYTICS_WEBSITE_ID

RUN pnpm build

# Production runtime image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nodejs

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches/
RUN pnpm install --frozen-lockfile --prod \
  && pnpm store prune \
  && chown -R nodejs:nodejs /app

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

USER nodejs
EXPOSE 8080

CMD ["node", "dist/index.js"]
