FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

EXPOSE 5173

# Dev server for this first module milestone; a production image would run
# `npm run build` and serve the static output behind nginx instead.
CMD ["npm", "run", "dev"]
