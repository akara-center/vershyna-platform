FROM node:24-bookworm-slim
WORKDIR /app
RUN install -d -m 0700 -o node -g node /data
COPY --chown=node:node dist ./dist
COPY --chown=node:node server ./server
USER node
ENV VERSHYNA_HOST=0.0.0.0 VERSHYNA_DB=/data/vershyna.sqlite
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "server/start.cjs"]
