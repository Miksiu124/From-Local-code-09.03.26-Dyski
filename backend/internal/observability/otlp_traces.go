// OTLP traces → Tempo (np. grafana/otel-lgtm). TracerProvider ustawia InitOpenTelemetry.
package observability

import (
	"context"
	"strings"

	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/embedded"
)

// echoTracerProvider — otelecho wywołuje Tracer() tylko raz przy rejestracji middleware i trzyma
// wynik w domknięciu. Gdyby Tracer() wołało GetTracerProvider().Tracer(...), dostałoby się
// jednorazowo Tracer z noop (async Init jeszcze nie doszedł). Dlatego zwracamy stały delegat,
// który w Start() zawsze bierze bieżący globalny provider.
type echoTracerProvider struct {
	embedded.TracerProvider
}

func (echoTracerProvider) Tracer(name string, opts ...trace.TracerOption) trace.Tracer {
	return echoDelegatingTracer{name: name, opts: opts}
}

type echoDelegatingTracer struct {
	embedded.Tracer
	name string
	opts []trace.TracerOption
}

func (t echoDelegatingTracer) Start(ctx context.Context, spanName string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	return otel.GetTracerProvider().Tracer(t.name, t.opts...).Start(ctx, spanName, opts...)
}

// EchoOTelTrace middleware HTTP → span (Tempo). Współgra z async InitOpenTelemetry (main).
func EchoOTelTrace(serviceName string) echo.MiddlewareFunc {
	if strings.TrimSpace(serviceName) == "" {
		serviceName = "content-api"
	}
	return otelecho.Middleware(serviceName,
		otelecho.WithTracerProvider(echoTracerProvider{}),
		otelecho.WithSkipper(func(c echo.Context) bool {
			p := c.Request().URL.Path
			return p == "/health" || strings.HasPrefix(p, "/health/")
		}),
	)
}
