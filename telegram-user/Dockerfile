FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
COPY public ./public
COPY tsconfig.json ./
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 4050

CMD ["sh", "-c", "npx prisma migrate deploy && node --import tsx src/server.ts"]
