# .devcontainer/Dockerfile
FROM mcr.microsoft.com/devcontainers/typescript-node:22

RUN npm install -g @anthropic-ai/claude-code \
    && npm install -g turbo \
    && apt-get update && apt-get install -y jq ripgrep

RUN npm install -g vitest eslint prettier