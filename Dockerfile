# syntax=docker/dockerfile:1

# Compile the native node-pty dependency in a disposable build stage.
FROM node:22-bookworm-slim AS dependencies
# Debian security patch versions intentionally follow the selected base image.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm rebuild node-pty \
    && node -e "require('node-pty'); console.log('node-pty native addon OK')"

# Runtime image: no compiler toolchain, and the server/Claude process run as
# the unprivileged `node` user supplied by the official Node image.
FROM node:22-bookworm-slim
# Debian security patch versions intentionally follow the selected base image.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    # Package managers are build-time tools only. Removing their bundled
    # dependency trees shrinks the runtime attack surface substantially.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && install -d -o node -g node /app /workspace /home/node/.claude /home/node/.claude-ui

ENV HOME=/home/node
USER node
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install Claude Code without copying host credentials into the image.
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && /home/node/.local/bin/claude --version
ENV PATH="/home/node/.local/bin:${PATH}"

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node docs ./docs
COPY --chown=node:node README.md LICENSE THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node LICENSES ./LICENSES

ENV NODE_ENV=production
EXPOSE 7681
CMD ["node", "server/index.mjs", "--host", "0.0.0.0", "--port", "7681"]
