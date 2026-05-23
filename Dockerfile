# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /workspace
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/api/package.json packages/api/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/connectors-mock/package.json packages/connectors-mock/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY packages/api packages/api
COPY packages/connectors-mock packages/connectors-mock
COPY packages/core packages/core
RUN pnpm --filter @access-kit/api... build
RUN pnpm deploy --filter @access-kit/api --prod --legacy /app

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV="production"
ENV REBAC_API_HOST="0.0.0.0"
ENV REBAC_API_PORT="3000"
ENV REBAC_API_ACTOR="service:api"
ENV REBAC_STATE_PATH="/var/lib/access-kit/state/runtime-state.json"
ENV REBAC_EVIDENCE_ROOT="/var/lib/access-kit/evidence"

RUN mkdir -p /var/lib/access-kit/state /var/lib/access-kit/evidence \
  && chown -R node:node /app /var/lib/access-kit

COPY --from=build --chown=node:node /app ./

USER node
EXPOSE 3000
VOLUME ["/var/lib/access-kit"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port = process.env.REBAC_API_PORT || '3000'; fetch('http://127.0.0.1:' + port + '/v1/ready').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "dist/bin.js"]
