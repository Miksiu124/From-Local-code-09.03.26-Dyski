# ═══════════════════════════════════════════════════════════════
# Content Platform — Go Backend Dockerfile
# ═══════════════════════════════════════════════════════════════

# ── Build Stage ───────────────────────────────────────────────
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Pełne źródło od razu — go mod tidy uzupełnia go.sum w obrazie (repo może nie commitować świeżych sum).
COPY . .
ARG TARGETARCH
RUN go mod tidy && go mod download && \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -ldflags="-w -s" -o /app/server ./cmd/server && \
    go build -ldflags="-w -s" -o /app/seed ./cmd/seed

# ── Runtime Stage ─────────────────────────────────────────────
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /app/server .
COPY --from=builder /app/seed .
COPY --from=builder /app/migrations ./migrations

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080

ENTRYPOINT ["./server"]
