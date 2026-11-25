FROM node:24-bookworm-slim
WORKDIR /app
RUN install -d -m 0700 -o node -g node /data
COPY --chown=node:node dist ./dist
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --omit=dev --no-audit --no-fund
COPY --chown=node:node server ./server
ENV VERSHYNA_HOST=0.0.0.0 VERSHYNA_DB=/data/vershyna.sqlite
EXPOSE 8787
ENTRYPOINT ["/bin/sh", "/app/server/container-start.sh"]
CMD ["node", "server/start.cjs"]
