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
    ca-certificates \
    libgcc-s1 \
    libstdc++6 \
    libgomp1 \
    libtinfo6 \
    file \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production && yarn cache clean

# Ensure bb binaries are executable and check dependencies
RUN if [ -d "/usr/src/app/node_modules/@aztec/bb.js/build" ]; then \
        echo "Making bb binaries executable..." && \
        find /usr/src/app/node_modules/@aztec/bb.js/build -name 'bb' -type f -exec chmod +x {} \; && \
        find /usr/src/app/node_modules/@aztec/bb.js/build -name '*.node' -type f -exec chmod +x {} \; && \
        BB_PATH=$(find /usr/src/app/node_modules/@aztec/bb.js/build -name 'bb' -type f 2>/dev/null | grep linux | head -1) && \
        if [ -n "$BB_PATH" ]; then \
            echo "Found bb at: $BB_PATH" && \
            file "$BB_PATH" && \
            echo "Checking dependencies:" && \
            ldd "$BB_PATH" 2>&1 || echo "ldd check completed"; \
        fi \
    fi

ENV SEARCH_HEX_VALUE=28da3fc471387d4e20b646b77abc8cdfc02a339a7507285a73d84f9b97b13486
ENV PXE_URL=http://138.201.52.21:8080

COPY --from=builder /usr/src/app/dest ./dest

EXPOSE 8080

CMD ["node", "./dest/index.js"]