FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached across code-only changes.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
EXPOSE 4000

# docker-compose overrides `command:` for the api and worker services (see
# docker-compose.yml) — this default is only used if the image is run
# standalone.
CMD ["node", "src/server.js"]
