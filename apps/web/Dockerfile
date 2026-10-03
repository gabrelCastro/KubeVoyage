# Build context: the repository root (the web app depends on packages/shared).
#   docker build -f apps/web/Dockerfile .
# The result is Caddy: it serves the app and proxies /api to the API, so both share one origin.

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
# shown on /privacidade
ARG OPERATOR_NAME
ARG CONTACT_EMAIL
RUN VITE_OPERATOR_NAME="$OPERATOR_NAME" VITE_CONTACT_EMAIL="$CONTACT_EMAIL" npm run build -w @kubelearn/web

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
