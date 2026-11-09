# One image: builds the client and runs the signaling/room-list server that also serves it.
# Dedicated rooms use the same image with a different command (see docker-compose.yml).
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @kart/client build
ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=/app/packages/client/dist
EXPOSE 8787
USER node
CMD ["pnpm", "--filter", "@kart/server", "start"]
