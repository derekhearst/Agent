# Build stage
FROM node:22-slim AS builder

WORKDIR /app

RUN npm install -g bun

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN DATABASE_URL=build.db VECTOR_DB_URL=build.db bun run build

# Production stage
FROM node:22-slim

WORKDIR /app

COPY package.json bun.lock* ./
RUN npm install -g bun && bun install --production --frozen-lockfile

COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle

# Create data directories
RUN mkdir -p /app/data /app/memory

ENV NODE_ENV=production
ENV PORT=3000
ENV ORIGIN=http://localhost:3000
ENV DATABASE_URL=/app/data/local.db
ENV VECTOR_DB_URL=/app/data/vector.db

EXPOSE 3000

CMD ["node", "build/index.js"]
