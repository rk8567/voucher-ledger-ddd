# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM deps AS migrate
WORKDIR /app
COPY . .
ENTRYPOINT ["npm", "run", "migrate", "--"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/.next ./.next
RUN mkdir -p .next/cache/fetch-cache && chown -R node:node .next

EXPOSE 3000
USER node
CMD ["npm", "run", "start"]
