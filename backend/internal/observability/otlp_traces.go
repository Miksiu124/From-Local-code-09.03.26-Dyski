// OTLP traces → Tempo (np. grafana/otel-lgtm) — ten sam endpoint co logi.
package observability

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// InitOTLPTraces rejestruje TracerProvider z eksportem OTLP/HTTP (zmienne OTEL_EXPORTER_OTLP_*).
// Gdy endpoint jest pusty, zwraca no-op shutdown.
func InitOTLPTraces(ctx context.Context, rawEndpoint, serviceName string) (shutdown func(context.Context) error, _ error) {
	raw := strings.TrimSpace(rawEndpoint)
	if raw == "" {
		return func(context.Context) error { return nil }, nil
	}
	if serviceName == "" {
		serviceName = "content-api"
	}
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		_ = os.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", raw)
	}

	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("otlp trace exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(serviceName)),
	)
	if err != nil {
		_ = exp.Shutdown(ctx)
		return nil, fmt.Errorf("otlp trace resource: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	log.Printf("otlp trace export on (service=%s)", serviceName)

	return func(c context.Context) error {
		return tp.Shutdown(c)
	}, nil
}

// EchoOTelTrace middleware HTTP → span (Tempo). Pomija /health.
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
