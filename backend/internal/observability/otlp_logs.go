// OTLP: slog → OpenTelemetry → collector (Loki) — używaj z grafana/otel-lgtm.
package observability

import (
	"encoding/json"
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

// otlechoSlog: jawny *slog.Logger z otelslog (nie slog.SetDefault) — unika martwego punktu przy rejestracji otelecho / startcie HTTP.
var otlechoSlog *slog.Logger

// echoUserIDKey must match middleware.UserIDKey string value ("userId") so we can attach
// user_id to Loki JSON without importing middleware (import cycle).
const echoUserIDKey = "userId"

// httpLogLoki: jeden JSON w treści wiersza (Loki/Explore: `| json`); mapuje pola z paneli Grafany (log_category, latency_ms, …).
type httpLogLoki struct {
	Msg         string `json:"msg"`
	Method      string `json:"method"`
	Path        string `json:"path"`
	Status      int    `json:"status"`
	LatencyMS   int64  `json:"latency_ms"`
	LogCategory string `json:"log_category"`
	ClientIP    string `json:"client_ip"`
	ReqID       string `json:"req_id"`
	UserID      string `json:"user_id,omitempty"`
	TraceID     string `json:"trace_id,omitempty"`
	SpanID      string `json:"span_id,omitempty"`
}

// EchoSlogOTLP opcjonalnie: jedna linia slog na żądanie (→ Loki), tylko gdy InitOpenTelemetry włączył logi.
// Ustaw po RequestID i po otelecho, żeby w logu były request_id i trace_id.
func EchoSlogOTLP() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			if !otlpLogsOn.Load() || otlechoSlog == nil {
				return err
			}
			rid := c.Response().Header().Get(echo.HeaderXRequestID)
			if rid == "" {
				rid = c.Request().Header.Get(echo.HeaderXRequestID)
			}
			var traceID, spanID string
			// Zawsze gdy jest span w kontekście — widoczność trace_id w Loki (korelacja, kopiowanie do Tempo).
			// Uwaga: przy OTEL_TRACES_SAMPLE_RATIO < 1 część ID nie będzie w Tempo; wtedy wyszukaj w Tempo / zwiększ ratio.
			if sc := trace.SpanContextFromContext(c.Request().Context()); sc.IsValid() {
				traceID = sc.TraceID().String()
				spanID = sc.SpanID().String()
			}
			var userID string
			if v := c.Get(echoUserIDKey); v != nil {
				if s, ok := v.(string); ok {
					userID = s
				}
			}
			clientIP := c.RealIP()
			if clientIP == "" {
				if h, _, err := net.SplitHostPort(strings.TrimSpace(c.Request().RemoteAddr)); err == nil {
					clientIP = h
				} else {
					clientIP = c.Request().RemoteAddr
				}
			}
			line, errJ := json.Marshal(httpLogLoki{
				Msg:         "http",
				Method:      c.Request().Method,
				Path:        c.Path(),
				Status:      c.Response().Status,
				LatencyMS:   time.Since(start).Milliseconds(),
				LogCategory: HTTPLogCategory(c.Path()),
				ClientIP:    clientIP,
				ReqID:       rid,
				UserID:      userID,
				TraceID:     traceID,
				SpanID:      spanID,
			})
			if errJ == nil {
				lg := otlechoSlog
				lg.Log(c.Request().Context(), slog.LevelInfo, string(line))
			}
			return err
		}
	}
}
