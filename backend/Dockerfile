FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /pdfeditor ./cmd/server

# Nonroot runtime: the server runs as pdfeditor (uid 10001).
# MIGRATION NOTE: the bind-mounted host ./data dir must be owned by uid 10001
# or the server cannot write documents. On hosts where ./data was created by
# the previous root-running image, run once:
#     chown -R 10001:10001 ./data
# debian-slim (not distroless): thumbnails shell out to pdftoppm (poppler).
FROM debian:stable-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --user-group --home-dir /app --shell /usr/sbin/nologin pdfeditor \
    && mkdir -p /app/data \
    && chown -R pdfeditor:pdfeditor /app
COPY --from=build /pdfeditor /usr/local/bin/pdfeditor
ENV PORT=8000 DATA_DIR=/app/data
EXPOSE 8000
VOLUME ["/app/data"]
USER pdfeditor
ENTRYPOINT ["pdfeditor"]
