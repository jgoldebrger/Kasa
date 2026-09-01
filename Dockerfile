# Production image for non-Vercel hosts. Vercel remains the primary deploy path.
# Build: docker build -t kasa:local .
# Run:   docker run --rm -p 3000:3000 --env-file .env.local kasa:local
#
# Requires next.config.js `output: 'standalone'` (already set).

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Satisfy boot-time env validation during `next build` without real secrets.
ENV MONGODB_URI=mongodb://placeholder.invalid/build
ENV NEXTAUTH_SECRET=docker-build-placeholder-secret-32chars
ENV AUTH_SECRET=docker-build-placeholder-secret-32chars
ENV ENCRYPTION_KEY=docker-build-encryption-key-32bytes-base64==
ENV CRON_SECRET=docker-build-cron-secret-placeholder-32chars
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache wget \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nextjs -u 1001 -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/livez || exit 1

CMD ["node", "server.js"]
