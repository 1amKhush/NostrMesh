FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
RUN npm install --quiet

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 4000

CMD ["dist/index.js"]
