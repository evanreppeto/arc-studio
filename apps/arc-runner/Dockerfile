# syntax=docker/dockerfile:1
# Standalone container for the Arc runner. Build context is apps/arc-runner only
# (the runner has no workspace-internal imports), so this is a plain npm build —
# no pnpm/workspace needed in the image.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Which build this is, answerable from outside. Baked into the IMAGE rather than
# set as a Cloud Run env var on purpose: `gcloud run deploy --set-env-vars`
# REPLACES the whole variable set, which would silently drop the runner's
# secrets, and the merge-safe `--update-env-vars` would still make the answer a
# property of the service rather than of the artifact. The commit that produced
# an image is intrinsic to it.
#
# Empty for a local `docker build` with no --build-arg, which is honest: that
# image did not come from the pipeline, and /health says so rather than
# reporting a SHA it cannot stand behind.
ARG ARC_RUNNER_COMMIT=""
ENV ARC_RUNNER_COMMIT=$ARC_RUNNER_COMMIT
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# The Claude Agent SDK spawns the Claude Code CLI at runtime — it must be on PATH.
RUN npm install -g @anthropic-ai/claude-code
COPY --from=build /app/dist ./dist
# Run as the non-root `node` user (uid 1000, built into the base image). REQUIRED:
# the SDK runs claude-code with --dangerously-skip-permissions (permissionMode
# "bypassPermissions"), which claude-code REFUSES under root. HOME=/tmp gives the
# CLI a writable config dir on Cloud Run's filesystem regardless of execution env.
ENV HOME=/tmp
RUN chown -R node:node /app
USER node
# Cloud Run injects PORT (8080); config.ts reads process.env.PORT.
CMD ["node", "dist/index.js"]
