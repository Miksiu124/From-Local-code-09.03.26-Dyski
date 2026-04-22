package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"content-platform-backend/internal/admin"
	"content-platform-backend/internal/auth"
	"content-platform-backend/internal/common"
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/content"
	"content-platform-backend/internal/credits"
	"content-platform-backend/internal/database"
	"content-platform-backend/internal/favorites"
	"content-platform-backend/internal/geo"
	"content-platform-backend/internal/growth"
	"content-platform-backend/internal/jobs"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/links"
	"content-platform-backend/internal/models"
	"content-platform-backend/internal/notifications"
	"content-platform-backend/internal/observability"
	"content-platform-backend/internal/purchases"
	"content-platform-backend/internal/referral"
	"content-platform-backend/internal/user"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	"go.opentelemetry.io/otel"
	oteltrace "go.opentelemetry.io/otel/trace"
)

func main() {
	// ── Load config ──────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	hlsCDN := cfg.HLSUsePublicCDNSegments && cfg.R2PublicURL != ""
	log.Printf("[config] HLS segments: R2_PUBLIC_URL set=%v HLS_USE_PUBLIC_CDN_SEGMENTS(effective)=%v HLS_USE_API_SEGMENTS=%v → .ts via public CDN=%v",
		cfg.R2PublicURL != "", cfg.HLSUsePublicCDNSegments, cfg.HLSUseAPISegments, hlsCDN)

	ctx := context.Background()

	// ── Database & Redis first — must not sit behind OTLP init (collector hang = no HTTP, empty site)
	pgPool, err := database.NewPostgresPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer pgPool.Close()
	log.Println("✓ Connected to PostgreSQL")

	jobSched := jobs.NewScheduler()
	defer jobSched.Stop()

	redisClient, err := database.NewRedisClient(ctx, cfg.RedisURL)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer redisClient.Close()
	log.Println("✓ Connected to Redis")

	// Globalny noop tracer zanim ukończy się async InitOpenTelemetry; inaczej otelecho może zablokować start (provider jeszcze pusty).
	otel.SetTracerProvider(oteltrace.NewNoopTracerProvider())

	// OpenTelemetry w tle — HTTP musi nasłuchiwać od razu; Loki/Tempo/metryki włączą się po połączeniu z kolektorem
	otlpShutdown := observability.LaunchOpenTelemetryAsync(cfg.OTLPLogEndpoint, cfg.OTELServiceName)

	// ── Echo server ──────────────────────────────────────────────────────
	e := echo.New()
	e.HideBanner = true
	
	// SECURITY PATTERN: Ufamy tylko zweryfikowanemu przez Nginx nagłówkowi X-Real-IP, zapobiegając fałszowaniu IP przez hakera w X-Forwarded-For
	e.IPExtractor = echo.ExtractIPFromRealIPHeader()

	// Global middleware (RequestID przed OTel HTTP, żeby req_id i span szły razem w logach)
	e.Use(echomw.Recover())
	e.Use(echomw.RequestID())
	e.Use(observability.EchoOTelTrace(cfg.OTELServiceName))
	e.Use(observability.EchoSlogOTLP())
	e.Use(echomw.Logger())
	e.Use(middleware.CORSMiddleware(cfg))
	e.Use(echomw.Secure())
	e.Use(echomw.BodyLimit("2M"))
	// Gzip JSON responses — skip binary (thumbnails, segments). Level 3 = less CPU than 5
	e.Use(echomw.GzipWithConfig(echomw.GzipConfig{
		Level: 3,
		Skipper: func(c echo.Context) bool {
			p := c.Path()
			return strings.Contains(p, "/thumbnail") || strings.Contains(p, "/segment") ||
				strings.Contains(p, "/avatar") || strings.Contains(p, "/header")
		},
	}))

	// Custom HTTP Error Handler to ensure all errors are JSON
	e.HTTPErrorHandler = func(err error, c echo.Context) {
		code := http.StatusInternalServerError
		if he, ok := err.(*echo.HTTPError); ok {
			code = he.Code
		}
		
		// If headers were already sent, just return
		if c.Response().Committed {
			return
		}

		// Send JSON error — never expose internal details to the client
		msg := http.StatusText(code)
		if he, ok2 := err.(*echo.HTTPError); ok2 && he.Message != nil {
			if s, ok3 := he.Message.(string); ok3 {
				msg = s
			}
		}
		if code == http.StatusInternalServerError {
			log.Printf("[HTTP] Internal error: %v", err)
			msg = http.StatusText(code)
		}
		_ = c.JSON(code, common.HTTPRecoverError(code, msg))
	}

	// ── Services ─────────────────────────────────────────────────────────
	authService := auth.NewService(cfg, pgPool, redisClient)
	r2Client := content.NewR2Client(cfg)
	r2ProofClient := content.NewR2ProofClient(cfg)
	contentService := content.NewService(pgPool, r2Client, cfg)

	// ── Auth middleware ──────────────────────────────────────────────────
	authMW := middleware.NewAuthMiddleware(cfg, redisClient, pgPool)
	adminMW := middleware.NewAdminMiddleware(cfg)

	// R2 sync: manual only via POST /api/admin/r2/sync (admin panel)

	// ── Rate limiter ─────────────────────────────────────────────────────
	rateLimiter := middleware.NewRateLimiter(redisClient)

	// ── Routes ───────────────────────────────────────────────────────────
	api := e.Group("/api")

	// Mailer
	mailService := mailer.New(cfg)

	if _, err := jobSched.AddJob("*/15 * * * *", func() {
		jctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		jobs.RunCheckoutAbandonmentReminders(jctx, pgPool, mailService, cfg)
		cancel()
	}); err != nil {
		log.Fatalf("checkout reminder cron: %v", err)
	}
	jobSched.Start()

	// Auth routes (public)
	authHandler := auth.NewHandler(authService, cfg, rateLimiter, mailService, redisClient)
	authGroup := api.Group("/auth")
	authGroup.POST("/register", authHandler.Register)
	authGroup.POST("/login", authHandler.Login)
	authGroup.POST("/logout", authHandler.Logout)
	authGroup.GET("/me", authHandler.Me, authMW.Authenticate)
	authGroup.GET("/verify-email", authHandler.VerifyEmail)
	authGroup.POST("/resend-verification", authHandler.ResendVerification, authMW.Authenticate)
	authGroup.POST("/resend-verification-public", authHandler.ResendVerificationPublic)
	authGroup.POST("/forgot-password", authHandler.ForgotPassword)
	authGroup.POST("/reset-password", authHandler.ResetPassword)
	authGroup.GET("/discord", authHandler.DiscordRedirect)
	authGroup.GET("/discord/callback", authHandler.DiscordCallback)

	// Models (public)
	modelsHandler := models.NewHandler(pgPool, cfg, redisClient)
	api.GET("/models", modelsHandler.List)
	api.GET("/models/stats", modelsHandler.GetStats) // Added
	api.GET("/models/:slug", modelsHandler.GetBySlug)
	api.GET("/models/:slug/content", modelsHandler.ListContent) // Added pagination endpoint
	api.GET("/models/:modelId/access", modelsHandler.CheckAccess, authMW.OptionalAuth)

	// Meta & Helpers
	geoHandler := geo.NewHandler()
	api.GET("/geo/country", geoHandler.GetUserCountry)

	// Funnel / growth events (browser → DB; optional auth for user_id)
	growthHandler := growth.NewHandler(pgPool, rateLimiter)
	api.POST("/growth-hacker", growthHandler.Ingest, authMW.OptionalAuth)
	api.GET("/countries", modelsHandler.ListCountries)
	api.GET("/settings/public", modelsHandler.GetPublicSettings)
	api.GET("/user/access", modelsHandler.GetUserAccess, authMW.OptionalAuth)

	// Public Custom Links
	linksHandler := links.NewHandler(pgPool, cfg)
	api.GET("/public/links/:slug", linksHandler.TrackAndResolveLink)

	// Content streaming (requires auth + access)
	contentHandler := content.NewHandler(pgPool, r2Client, cfg, redisClient)
	
	// Model images (public)
	api.GET("/models/:slug/avatar", contentHandler.ModelAvatar)
	api.GET("/models/:slug/header", contentHandler.ModelHeader)
	api.GET("/models/:slug/thumbnail", contentHandler.ModelAvatar)

	contentGroup := api.Group("/content")
	contentGroup.GET("/:slug/:contentItemId/details", contentHandler.GetContentDetails, authMW.OptionalAuth)
	contentGroup.GET("/:id/thumbnail", contentHandler.Thumbnail, authMW.OptionalAuth)
	contentGroup.GET("/:id/thumbnail/:filename", contentHandler.Thumbnail, authMW.OptionalAuth)
	contentGroup.GET("/:id/source", contentHandler.DownloadSource, authMW.Authenticate, authMW.RequireEmailVerified)
	contentGroup.GET("/:id/playlist/:filename", contentHandler.Playlist, authMW.Authenticate, authMW.RequireEmailVerified)
	contentGroup.GET("/:id/segment/:filename", contentHandler.Segment) // token-validated

	// Credits (requires auth)
	creditsHandler := credits.NewHandler(pgPool, redisClient, cfg, r2ProofClient)
	creditsGroup := api.Group("/credits", authMW.Authenticate)
	creditsGroup.POST("/purchase", creditsHandler.CreatePurchase, authMW.RequireEmailVerified)
	creditsGroup.POST("/validate-promo", creditsHandler.ValidatePromo)
	creditsGroup.POST("/purchase/:id/proof", creditsHandler.UploadProof, echomw.BodyLimit("12M"))
	creditsGroup.GET("/purchase/:id/status", creditsHandler.GetPurchaseStatus)
	creditsGroup.GET("/purchase/:id/stream", creditsHandler.StreamPurchaseStatus)
	creditsGroup.POST("/purchase/:id/txid", creditsHandler.SubmitTxId)
	creditsGroup.POST("/purchase/:id/blik", creditsHandler.UpdateBlikCode)
	creditsGroup.GET("/purchase", creditsHandler.ListPurchases)

	api.GET("/credit-packages", creditsHandler.ListPackages)

	// BLIK WebSocket
	api.GET("/credits/purchase/:id/blik", creditsHandler.BlikWebSocket, authMW.Authenticate)

	// Purchases (requires auth)
	purchasesHandler := purchases.NewHandler(pgPool, cfg, redisClient)
	api.POST("/purchases", purchasesHandler.Create, authMW.Authenticate, authMW.RequireEmailVerified)
    api.GET("/purchases", purchasesHandler.List, authMW.Authenticate) // Added List

	// Favorites (requires auth)
	favoritesHandler := favorites.NewHandler(pgPool, cfg)
	favGroup := api.Group("/favorites", authMW.Authenticate)
	favGroup.POST("", favoritesHandler.Toggle)
	favGroup.GET("", favoritesHandler.List)
	favGroup.GET("/:contentItemId/details", favoritesHandler.GetDetails)
	favGroup.POST("/check", favoritesHandler.BatchCheck)

	// Notifications (requires auth)
	notifHandler := notifications.NewHandler(pgPool, redisClient)
	notifGroup := api.Group("/notifications", authMW.Authenticate)
	notifGroup.GET("", notifHandler.List)
	notifGroup.GET("/stream", notifHandler.Stream)
	notifGroup.PATCH("", notifHandler.MarkAllRead)

	// User (requires auth)
	userHandler := user.NewHandler(pgPool, mailService)
	api.GET("/user/balance", userHandler.GetBalance, authMW.Authenticate)
	api.GET("/user/profile", userHandler.GetProfile, authMW.Authenticate)
	api.PATCH("/user/profile", userHandler.UpdateProfile, authMW.Authenticate)
	api.PATCH("/user/email", userHandler.UpdateEmail, authMW.Authenticate)
	api.PATCH("/user/password", userHandler.UpdatePassword, authMW.Authenticate)
	api.PATCH("/user/autoplay", userHandler.UpdateAutoplay, authMW.Authenticate)
	api.GET("/user/preferences", userHandler.GetPreferences, authMW.Authenticate)

	// Referral (requires auth)
	referralHandler := referral.NewHandler(pgPool, cfg, rateLimiter)
	api.GET("/referral/me", referralHandler.GetMe, authMW.Authenticate)

	// Public referral link tracking (no auth) - /r/[code] redirects here
	api.GET("/public/referral/:code", referralHandler.TrackAndRedirect)

	obsHandler := observability.NewHandler(pgPool, rateLimiter, cfg.PostgresBackupDir, cfg.PostgresBackupDBName)
	api.POST("/public/client-errors", obsHandler.PostClientError)

	// ── Admin routes (requires auth + admin) ─────────────────────────────
	adminGroup := api.Group("/admin", authMW.Authenticate, adminMW.RequireAdmin)
	adminHandler := admin.NewHandler(pgPool, r2Client, r2ProofClient, cfg, redisClient, contentService, mailService)

	adminGroup.GET("/credits/purchases", adminHandler.ListCreditPurchases)
	adminGroup.GET("/credits/purchases/stream", adminHandler.StreamPendingPurchases)
	adminGroup.GET("/credits/purchases/:id/proof", adminHandler.GetPurchaseProof)
	adminGroup.POST("/credits/purchases/:id/approve", adminHandler.ApprovePurchase)
	// Alias: some proxies/WAFs block path segment "approve"; UI uses /complete
	adminGroup.POST("/credits/purchases/:id/complete", adminHandler.ApprovePurchase)
	adminGroup.POST("/credits/purchases/:id/reject", adminHandler.RejectPurchase)
	adminGroup.GET("/users", adminHandler.ListUsers)
	adminGroup.GET("/users/:id", adminHandler.GetUser)
	adminGroup.PATCH("/users/:id", adminHandler.UpdateUser)
	adminGroup.DELETE("/users/:id", adminHandler.DeleteUser)
	adminGroup.POST("/users/:id/credits", adminHandler.UpdateUserCredits)
	adminGroup.POST("/users/:id/ban", adminHandler.ToggleBan)
	adminGroup.POST("/users/:id/access", adminHandler.GrantAccess)
	adminGroup.DELETE("/users/:id/access", adminHandler.RevokeAccess)
	adminGroup.GET("/packages", adminHandler.ListPackages)
	adminGroup.POST("/packages", adminHandler.CreatePackage)
	adminGroup.PATCH("/packages/:id", adminHandler.UpdatePackage)
	adminGroup.DELETE("/packages/:id", adminHandler.DeletePackage)
	adminGroup.GET("/promo-codes", adminHandler.ListPromoCodes)
	adminGroup.POST("/promo-codes", adminHandler.CreatePromoCode)
	adminGroup.PATCH("/promo-codes/:id", adminHandler.UpdatePromoCode)
	adminGroup.DELETE("/promo-codes/:id", adminHandler.DeletePromoCode)
	adminGroup.GET("/custom-links", adminHandler.ListCustomLinks)
	adminGroup.POST("/custom-links", adminHandler.CreateCustomLink)
	adminGroup.PATCH("/custom-links/:id", adminHandler.UpdateCustomLink)
	adminGroup.DELETE("/custom-links/:id", adminHandler.DeleteCustomLink)
	adminGroup.GET("/custom-links/:id/analytics", adminHandler.GetCustomLinkAnalytics)
	adminGroup.GET("/models", adminHandler.ListModels)
	adminGroup.PATCH("/models", adminHandler.UpdateModel)
	adminGroup.PATCH("/content/hidden", adminHandler.ToggleContentHidden)
	adminGroup.DELETE("/content/:id", adminHandler.DeleteContent)
	adminGroup.GET("/settings", adminHandler.GetSettings)
	adminGroup.PUT("/settings", adminHandler.UpdateSettings)
	adminGroup.POST("/r2/sync", adminHandler.SyncR2)
	adminGroup.POST("/r2/import", adminHandler.ImportR2)
	adminGroup.POST("/r2/avatars", adminHandler.UploadAvatar, echomw.BodyLimit("6M"))
	adminGroup.GET("/analytics", adminHandler.GetAnalytics)
	adminGroup.GET("/content-performance", adminHandler.GetContentPerformance)
	adminGroup.GET("/catalog-model-performance", adminHandler.GetCatalogModelPerformance)
	adminGroup.POST("/content/bulk-zip", adminHandler.BulkDownloadContentZip, echomw.BodyLimit("512k"))
	adminGroup.GET("/content/:id/source-download", adminHandler.DownloadContentSource)
	adminGroup.GET("/growth-events", growthHandler.ListGrowthEvents)
	adminGroup.GET("/growth-funnel", growthHandler.FunnelSummary)
	adminGroup.GET("/observability/client-errors", obsHandler.ListClientErrors)
	adminGroup.DELETE("/observability/client-errors", obsHandler.ClearClientErrors)
	adminGroup.GET("/observability/runtime", obsHandler.GetRuntimeStats)
	adminGroup.GET("/observability/db-backup", obsHandler.GetDBBackupStatus)

	// ── Health check ─────────────────────────────────────────────────────
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"status":  "ok",
			"message": "Service is running.",
		})
	})

	// ── Graceful shutdown ────────────────────────────────────────────────
	go func() {
		addr := fmt.Sprintf(":%s", cfg.Port)
		log.Printf("🚀 Server starting on %s", addr)
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	otelShutdownCtx, otelShutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer otelShutdownCancel()
	if err := otlpShutdown(otelShutdownCtx); err != nil {
		log.Printf("OpenTelemetry shutdown: %v", err)
	}
	log.Println("Server exited cleanly")
}
