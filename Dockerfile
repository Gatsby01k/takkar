FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY public ./public
COPY server ./server
COPY bot ./bot
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/server.mjs"]
