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
RUN date && echo "===== BB BINARY CHECK START =====" && \
    ls -la /usr/src/app/node_modules/@aztec/bb.js/build/ 2>&1 || echo "build dir not found" && \
    find /usr/src/app/node_modules/@aztec/bb.js/build -name 'bb' -type f -exec chmod +x {} \; 2>&1 || echo "chmod bb failed" && \
    find /usr/src/app/node_modules/@aztec/bb.js/build -name '*.node' -type f -exec chmod +x {} \; 2>&1 || echo "chmod .node failed" && \
    BB_PATH=$(find /usr/src/app/node_modules/@aztec/bb.js/build -name 'bb' -type f 2>/dev/null | grep linux | head -1) && \
    echo "BB_PATH: $BB_PATH" && \
    if [ -n "$BB_PATH" ]; then \
        file "$BB_PATH" && \
        echo "--- ldd output ---" && \
        ldd "$BB_PATH" && \
        echo "--- Testing bb binary ---" && \
        "$BB_PATH" --version 2>&1 || echo "bb execution failed with exit code: $?"; \
    else \
        echo "ERROR: BB binary not found!"; \
    fi && \
    echo "===== BB BINARY CHECK END ====="

ENV SEARCH_HEX_VALUE=28da3fc471387d4e20b646b77abc8cdfc02a339a7507285a73d84f9b97b13486
ENV PXE_URL=http://138.201.52.21:8080

COPY --from=builder /usr/src/app/dest ./dest

EXPOSE 8080

CMD ["node", "./dest/index.js"]