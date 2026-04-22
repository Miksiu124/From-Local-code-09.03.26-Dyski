// OTLP: slog → OpenTelemetry → collector (Loki) — używaj z grafana/otel-lgtm.
package observability

import (
	"log/slog"

	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/otel/trace"
)

// otlpLogsOn jest true po udanym InitOpenTelemetry z niepustym endpointem.
var otlpLogsOn bool

// EchoSlogOTLP opcjonalnie: jedna linia slog na żądanie (→ Loki), tylko gdy InitOpenTelemetry włączył logi.
// Ustaw po RequestID i po otelecho, żeby w logu były request_id i trace_id.
func EchoSlogOTLP() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			err := next(c)
			if !otlpLogsOn {
				return err
			}
			rid := c.Response().Header().Get(echo.HeaderXRequestID)
			if rid == "" {
				rid = c.Request().Header().Get(echo.HeaderXRequestID)
			}
			var traceID, spanID string
			if sc := trace.SpanContextFromContext(c.Request().Context()); sc.IsValid() {
				traceID = sc.TraceID().String()
				spanID = sc.SpanID().String()
			}
			slog.Info("http",
				"method", c.Request().Method,
				"path", c.Path(),
				"status", c.Response().Status,
				"req_id", rid,
				"trace_id", traceID,
				"span_id", spanID,
			)
			return err
		}
	}
}
