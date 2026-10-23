# DiamondAgentIQ: web page + POST /run on port 8787.
#   docker build -t diamondagentiq .
#   docker run --rm -p 8787:8787 -e SAMPLE_MODE=true diamondagentiq          # no credentials
#   docker run --rm -p 8787:8787 --env-file .env diamondagentiq              # live (see README)
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=development \
    DIQ_HOST=0.0.0.0 \
    DIQ_PORT=8787 \
    DIQ_MEMORY_DIR=/app/memory

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN mkdir -p /app/logs /app/memory

EXPOSE 8787
CMD ["npx", "tsx", "src/scripts/start.ts"]
