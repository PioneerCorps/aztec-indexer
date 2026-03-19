# Build stage
FROM node:22 AS builder
WORKDIR /usr/src/app

COPY package*.json yarn.lock* ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Production stage
FROM node:22
WORKDIR /usr/src/app

# Install dependencies required for bb native binary
RUN apt-get update && apt-get install -y \
    libc6 \
    libstdc++6 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

ENV SEARCH_HEX_VALUE=28da3fc471387d4e20b646b77abc8cdfc02a339a7507285a73d84f9b97b13486
ENV PXE_URL=http://138.201.52.21:8080
ENV DEBUG=*

COPY --from=builder /usr/src/app/dest ./dest

EXPOSE 8080

CMD ["node", "./dest/index.js"]