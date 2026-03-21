# Dockerfile for nia-opencode plugin testing
# Uses Bun runtime for TypeScript build and test execution

FROM oven/bun:1.2.4-alpine

# Install additional dependencies for testing
RUN apk add --no-cache git curl

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json tsconfig.json ./

# Install dependencies
RUN bun install

# Copy source code
COPY src ./src
COPY tests ./tests
COPY instructions ./instructions

# Build the project
RUN bun run build

# Set environment variables for testing
ENV NODE_ENV=test
ENV CI=true

# Default command runs the full test suite
CMD ["bun", "test"]
