FROM debian:bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

RUN useradd -r -u 10001 appuser

COPY --chown=appuser:appuser build /app

EXPOSE 7990
USER appuser

CMD ["/app/server"]
