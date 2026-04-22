// OTLP: slog → OpenTelemetry → collector (Loki) — używaj z grafana/otel-lgtm.
package observability

import (
	"log/slog"
	"net"
	"strings"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/otel/trace"
)

// otlpLogsOn jest true po udanym InitOpenTelemetry z niepustym endpointem.
var otlpLogsOn atomic.Bool

// EchoSlogOTLP opcjonalnie: jedna linia slog na żądanie (→ Loki), tylko gdy InitOpenTelemetry włączył logi.
// Ustaw po RequestID i po otelecho, żeby w logu były request_id i trace_id.
func EchoSlogOTLP() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			if !otlpLogsOn.Load() {
				return err
			}
			rid := c.Response().Header().Get(echo.HeaderXRequestID)
			if rid == "" {
				rid = c.Request().Header.Get(echo.HeaderXRequestID)
			}
			var traceID, spanID string
			if sc := trace.SpanContextFromContext(c.Request().Context()); sc.IsValid() {
				traceID = sc.TraceID().String()
				spanID = sc.SpanID().String()
			}
			clientIP := c.RealIP()
			if clientIP == "" {
				if h, _, err := net.SplitHostPort(strings.TrimSpace(c.Request().RemoteAddr)); err == nil {
					clientIP = h
				} else {
					clientIP = c.Request().RemoteAddr
				}
			}
			slog.Info("http",
				"method", c.Request().Method,
				"path", c.Path(),
				"status", c.Response().Status,
				"latency_ms", time.Since(start).Milliseconds(),
				"log_category", HTTPLogCategory(c.Path()),
				"client_ip", clientIP,
				"req_id", rid,
				"trace_id", traceID,
				"span_id", spanID,
			)
			return err
		}
	}
}
