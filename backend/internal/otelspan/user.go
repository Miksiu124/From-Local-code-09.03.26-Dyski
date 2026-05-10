// Package otelspan holds small OTel helpers used from middleware without creating
// an import cycle (observability imports middleware via its HTTP handler).
package otelspan

import (
	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// AnnotateHTTPServerSpanWithUser sets standard attributes on the active HTTP server span
// so Tempo / TraceQL can filter traces by user (e.g. burst traffic or latency from one account).
func AnnotateHTTPServerSpanWithUser(c echo.Context, userID, role string) {
	if userID == "" {
		return
	}
	span := trace.SpanFromContext(c.Request().Context())
	if !span.IsRecording() {
		return
	}
	kvs := []attribute.KeyValue{attribute.String("enduser.id", userID)}
	if role != "" {
		kvs = append(kvs, attribute.String("enduser.role", role))
	}
	span.SetAttributes(kvs...)
}
