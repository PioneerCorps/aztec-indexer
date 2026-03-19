# Build stage
FROM node:22 AS builder
WORKDIR /usr/src/app

COPY package*.json yarn.lock* ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Production stage - use Ubuntu 24.04 with Node 22 for newer GLIBC
FROM ubuntu:24.04
WORKDIR /usr/src/app

# Install Node.js 22 and required dependencies for bb native binary
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && corepack enable \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

ENV SEARCH_HEX_VALUE=28da3fc471387d4e20b646b77abc8cdfc02a339a7507285a73d84f9b97b13486
ENV PXE_URL=http://138.201.52.21:8080

COPY --from=builder /usr/src/app/dest ./dest

EXPOSE 8080

CMD ["node", "./dest/index.js"]