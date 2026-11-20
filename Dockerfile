# Builds the game and serves it with nginx.
# The build stage always runs on the build machine's own platform (fast, no emulation);
# only the small nginx stage is per target platform (e.g. linux/arm64 for a Raspberry Pi).

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
# Commit id shown in the game's bug-report info
ARG BUILD_ID=""
ENV BUILD_ID=$BUILD_ID
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
