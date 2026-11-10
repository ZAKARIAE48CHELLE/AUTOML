# syntax=docker/dockerfile:1
# Image de production : build Vite puis service statique par nginx.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY packages packages
COPY apps/web apps/web
# Les variables VITE_* sont figées au build.
ARG VITE_MOCK_MODULES=data,training,assistant,studio
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_MOCK_MODULES=$VITE_MOCK_MODULES VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build -w apps/web

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
