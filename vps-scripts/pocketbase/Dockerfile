FROM alpine:3.24.1@sha256:79ff19e9084a00eece421b2523fb93e22d730e2c0e525905de047e848e56d95f AS download

ARG POCKETBASE_VERSION=0.40.3
ARG POCKETBASE_SHA256=8d81b6b79add0e219373e922ebe1dddbee7f57fcff602e3585e0d2c654b983ce

RUN apk add --no-cache ca-certificates unzip

WORKDIR /tmp/pocketbase-download

RUN archive="pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip" \
    && release_url="https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}" \
    && wget --quiet "${release_url}/${archive}" \
    && wget --quiet "${release_url}/checksums.txt" \
    && grep "  ${archive}$" checksums.txt > selected-checksum.txt \
    && test "$(cut -d ' ' -f 1 selected-checksum.txt)" = "${POCKETBASE_SHA256}" \
    && sha256sum -c selected-checksum.txt \
    && unzip -q "${archive}" pocketbase \
    && chmod 0755 pocketbase

FROM alpine:3.24.1@sha256:79ff19e9084a00eece421b2523fb93e22d730e2c0e525905de047e848e56d95f

ARG POCKETBASE_VERSION=0.40.3

LABEL org.opencontainers.image.title="Cuddlebuns PocketBase" \
      org.opencontainers.image.version="${POCKETBASE_VERSION}" \
      org.opencontainers.image.source="https://github.com/EIIwyn/cuddlebuns"

RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 pocketbase \
    && adduser -S -D -H -u 10001 -G pocketbase pocketbase \
    && mkdir -p /pb/pb_data /pb/pb_migrations \
    && chown -R 10001:10001 /pb

COPY --from=download /tmp/pocketbase-download/pocketbase /usr/local/bin/pocketbase
COPY --chown=10001:10001 --chmod=0444 pb_migrations /pb/pb_migrations

ENV HOME=/pb

WORKDIR /pb
USER 10001:10001

EXPOSE 8090
STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/local/bin/pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--migrationsDir=/pb/pb_migrations", "--automigrate=0"]
