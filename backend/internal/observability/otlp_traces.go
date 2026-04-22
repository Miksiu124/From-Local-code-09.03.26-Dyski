// OTLP traces → Tempo (np. grafana/otel-lgtm). TracerProvider ustawia InitOpenTelemetry.
package observability

import (
	"strings"

	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho"
)

// EchoOTelTrace middleware HTTP → span (Tempo). Wymaga wcześniejszego InitOpenTelemetry.
func EchoOTelTrace(serviceName string) echo.MiddlewareFunc {
	if strings.TrimSpace(serviceName) == "" {
		serviceName = "content-api"
	}
	return otelecho.Middleware(serviceName,
		otelecho.WithSkipper(func(c echo.Context) bool {
			p := c.Request().URL.Path
			return p == "/health" || strings.HasPrefix(p, "/health/")
		}),
	)
}
