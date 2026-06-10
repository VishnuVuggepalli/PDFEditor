FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /pdfeditor ./cmd/server

# Root variant: the bind-mounted ./data dir is host-owned; running nonroot
# would require chowning the host dir. Acceptable trade-off for local use.
# debian-slim (not distroless): thumbnails shell out to pdftoppm (poppler).
FROM debian:stable-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /pdfeditor /usr/local/bin/pdfeditor
ENV PORT=8000 DATA_DIR=/app/data
EXPOSE 8000
VOLUME ["/app/data"]
ENTRYPOINT ["pdfeditor"]
