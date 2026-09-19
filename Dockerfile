FROM node:22.19.0-alpine3.21 AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json server.js ./
COPY providers ./providers
COPY public ./public

RUN npm ci --omit=dev

RUN addgroup -S readgate && adduser -S readgate -G readgate
USER readgate

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server.js"]