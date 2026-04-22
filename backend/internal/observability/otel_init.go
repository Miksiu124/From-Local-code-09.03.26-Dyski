package observability

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	otelruntime "go.opentelemetry.io/contrib/instrumentation/runtime"
	otlploghttp "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	otlpmetrichttp "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	otlptracehttp "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	"go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
)

// OtelExportEnabled is true after successful InitOpenTelemetry with a non-empty OTLP endpoint.
var OtelExportEnabled bool

// InitOpenTelemetry configures OTLP log, trace, and metric export when rawEndpoint is non-empty.
// Uses OTEL_EXPORTER_OTLP_* from the environment (same as Grafana Cloud / otel-lgtm).
func InitOpenTelemetry(ctx context.Context, rawEndpoint, serviceName string) (shutdown func(context.Context) error, _ error) {
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

	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(serviceName)),
	)
	if err != nil {
		return nil, fmt.Errorf("otel resource: %w", err)
	}

	logExporter, err := otlploghttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("otlp log exporter: %w", err)
	}
	logProcessor := log.NewSimpleProcessor(logExporter)
	logProvider := log.NewLoggerProvider(
		log.WithResource(res),
		log.WithProcessor(logProcessor),
	)
	global.SetLoggerProvider(logProvider)

	traceExporter, err := otlptracehttp.New(ctx)
	if err != nil {
		_ = logExporter.Shutdown(ctx)
		return nil, fmt.Errorf("otlp trace exporter: %w", err)
	}
	tp := trace.NewTracerProvider(
		trace.WithBatcher(traceExporter),
		trace.WithResource(res),
		trace.WithSampler(traceSampler()),
	)

	metricExporter, err := otlpmetrichttp.New(ctx)
	if err != nil {
		_ = traceExporter.Shutdown(ctx)
		_ = logExporter.Shutdown(ctx)
		return nil, fmt.Errorf("otlp metric exporter: %w", err)
	}
	reader := metric.NewPeriodicReader(metricExporter, metric.WithInterval(15*time.Second))
	mp := metric.NewMeterProvider(
		metric.WithResource(res),
		metric.WithReader(reader),
	)

	// Global providers (otelecho + runtime instrumentation).
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	otel.SetMeterProvider(mp)

	if err := otelruntime.Start(otelruntime.WithMinimumReadMemStatsInterval(10 * time.Second)); err != nil {
		_ = mp.Shutdown(ctx)
		_ = traceExporter.Shutdown(ctx)
		_ = logExporter.Shutdown(ctx)
		return nil, fmt.Errorf("runtime metrics: %w", err)
	}

	h := otelslog.NewHandler("content-platform-backend", otelslog.WithLoggerProvider(logProvider))
	slog.SetDefault(slog.New(h))
	otlpLogsOn = true
	OtelExportEnabled = true
	slog.Info("otel export on", "otlp_endpoint", os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"), "service", serviceName)

	return func(sctx context.Context) error {
		var first error
		if err := mp.Shutdown(sctx); err != nil && first == nil {
			first = err
		}
		if err := tp.Shutdown(sctx); err != nil && first == nil {
			first = err
		}
		_ = logProvider.ForceFlush(sctx)
		if err := logProvider.Shutdown(sctx); err != nil && first == nil {
			first = err
		}
		return first
	}, nil
}

func traceSampler() trace.Sampler {
	r := 0.25
	if s := strings.TrimSpace(os.Getenv("OTEL_TRACES_SAMPLE_RATIO")); s != "" {
		if v, err := strconv.ParseFloat(s, 64); err == nil && v >= 0 && v <= 1 {
			r = v
		}
	}
	if r >= 1 {
		return trace.ParentBased(trace.AlwaysSample())
	}
	if r <= 0 {
		return trace.ParentBased(trace.NeverSample())
	}
	return trace.ParentBased(trace.TraceIDRatioBased(r))
}
