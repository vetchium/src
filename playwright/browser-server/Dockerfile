# The UI tests' Chromium runs here, inside the Docker VM: Chromium on a macOS
# host fails pending requests with net::ERR_NETWORK_CHANGED whenever the host
# renews an address (Wi-Fi IPv6 does several times an hour), even requests to
# loopback. The image tag, the browser revision it ships, and playwright-core
# below must match the @playwright/test version in ../package.json.
FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

WORKDIR /opt/browser-server
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

USER pwuser
EXPOSE 3000

CMD ["node", "node_modules/playwright-core/cli.js", "run-server", "--host", "0.0.0.0", "--port", "3000"]
