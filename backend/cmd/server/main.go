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
	"content-platform-backend/internal/config"
	"content-platform-backend/internal/content"
	"content-platform-backend/internal/credits"
	"content-platform-backend/internal/database"
	"content-platform-backend/internal/favorites"
	"content-platform-backend/internal/geo"
	"content-platform-backend/internal/mailer"
	"content-platform-backend/internal/middleware"
	"content-platform-backend/internal/links"
	"content-platform-backend/internal/models"
	"content-platform-backend/internal/notifications"
	"content-platform-backend/internal/purchases"
	"content-platform-backend/internal/referral"
	"content-platform-backend/internal/user"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
)

func main() {
	// ── Load config ──────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	ctx := context.Background()

	// ── Database connections ─────────────────────────────────────────────
	pgPool, err := database.NewPostgresPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer pgPool.Close()
	log.Println("✓ Connected to PostgreSQL")

	redisClient, err := database.NewRedisClient(ctx, cfg.RedisURL)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer redisClient.Close()
	log.Println("✓ Connected to Redis")

	// ── Echo server ──────────────────────────────────────────────────────
	e := echo.New()
	e.HideBanner = true
	
	// SECURITY PATTERN: Ufamy tylko zweryfikowanemu przez Nginx nagłówkowi X-Real-IP, zapobiegając fałszowaniu IP przez hakera w X-Forwarded-For
	e.IPExtractor = echo.ExtractIPFromRealIPHeader()

	// Global middleware
	e.Use(echomw.Recover())
	e.Use(echomw.RequestID())
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
			msg = "Internal server error"
		}
		_ = c.JSON(code, map[string]interface{}{
			"error":   http.StatusText(code),
			"message": msg,
		})
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
	rlDisabled := cfg.DisableAPIRateLimit
	publicRL := middleware.APIRateLimitEcho(rateLimiter, "public", 300, 60*1000, rlDisabled)
	contentRL := middleware.APIRateLimitEcho(rateLimiter, "content", 200, 60*1000, rlDisabled)
	creditsRL := middleware.APIRateLimitEcho(rateLimiter, "credits", 30, 60*1000, rlDisabled)
	userRL := middleware.APIRateLimitEcho(rateLimiter, "user", 120, 60*1000, rlDisabled)
	adminRL := middleware.APIRateLimitEcho(rateLimiter, "admin", 100, 60*1000, rlDisabled)

	// ── Routes ───────────────────────────────────────────────────────────
	api := e.Group("/api")

	// Mailer
	mailService := mailer.New(cfg)

	// Auth routes (public) — granular Redis limits live in auth handlers, not group middleware
	authHandler := auth.NewHandler(authService, cfg, rateLimiter, mailService, redisClient)
	authGroup := api.Group("/auth")
	authGroup.POST("/register", authHandler.Register)
	authGroup.POST("/login", authHandler.Login)
	authGroup.POST("/logout", authHandler.Logout)
	authGroup.GET("/me", authHandler.Me, authMW.Authenticate)
	authGroup.GET("/verify-email", authHandler.VerifyEmail)
	authGroup.POST("/resend-verification", authHandler.ResendVerification, authMW.Authenticate)
	authGroup.POST("/forgot-password", authHandler.ForgotPassword)
	authGroup.POST("/reset-password", authHandler.ResetPassword)
	authGroup.GET("/discord", authHandler.DiscordRedirect)
	authGroup.GET("/discord/callback", authHandler.DiscordCallback)

	modelsHandler := models.NewHandler(pgPool, cfg, redisClient)
	contentHandler := content.NewHandler(pgPool, r2Client, cfg, redisClient)
	creditsHandler := credits.NewHandler(pgPool, redisClient, cfg, r2ProofClient)
	purchasesHandler := purchases.NewHandler(pgPool, cfg, redisClient)
	favoritesHandler := favorites.NewHandler(pgPool)
	notifHandler := notifications.NewHandler(pgPool, redisClient)
	userHandler := user.NewHandler(pgPool, mailService)
	referralHandler := referral.NewHandler(pgPool, cfg, rateLimiter)
	linksHandler := links.NewHandler(pgPool, cfg)
	geoHandler := geo.NewHandler()

	// Public + catalog (rate: public)
	pub := api.Group("", publicRL)
	pub.GET("/models", modelsHandler.List)
	pub.GET("/models/stats", modelsHandler.GetStats)
	pub.GET("/models/:slug", modelsHandler.GetBySlug)
	pub.GET("/models/:slug/content", modelsHandler.ListContent)
	pub.GET("/models/:modelId/access", modelsHandler.CheckAccess, authMW.OptionalAuth)
	pub.GET("/geo/country", geoHandler.GetUserCountry)
	pub.GET("/countries", modelsHandler.ListCountries)
	pub.GET("/settings/public", modelsHandler.GetPublicSettings)
	pub.GET("/user/access", modelsHandler.GetUserAccess, authMW.OptionalAuth)
	pub.GET("/public/links/:slug", linksHandler.TrackAndResolveLink)
	pub.GET("/models/:slug/avatar", contentHandler.ModelAvatar)
	pub.GET("/models/:slug/header", contentHandler.ModelHeader)
	pub.GET("/models/:slug/thumbnail", contentHandler.ModelAvatar)
	pub.GET("/credit-packages", creditsHandler.ListPackages)
	pub.GET("/public/referral/:code", referralHandler.TrackAndRedirect)

	// Content / streaming (rate: content)
	cont := api.Group("", contentRL)
	cont.GET("/content/:slug/:contentItemId/details", contentHandler.GetContentDetails, authMW.OptionalAuth)
	cont.GET("/content/:id/thumbnail", contentHandler.Thumbnail, authMW.OptionalAuth)
	cont.GET("/content/:id/thumbnail/:filename", contentHandler.Thumbnail, authMW.OptionalAuth)
	cont.GET("/content/:id/playlist/:filename", contentHandler.Playlist, authMW.Authenticate, authMW.RequireEmailVerified)
	cont.GET("/content/:id/segment/:filename", contentHandler.Segment)

	// Credits (rate: credits)
	creditsGroup := api.Group("/credits", creditsRL, authMW.Authenticate)
	creditsGroup.POST("/purchase", creditsHandler.CreatePurchase, authMW.RequireEmailVerified)
	creditsGroup.POST("/validate-promo", creditsHandler.ValidatePromo)
	creditsGroup.POST("/purchase/:id/proof", creditsHandler.UploadProof, echomw.BodyLimit("12M"))
	creditsGroup.GET("/purchase/:id/status", creditsHandler.GetPurchaseStatus)
	creditsGroup.GET("/purchase/:id/stream", creditsHandler.StreamPurchaseStatus)
	creditsGroup.POST("/purchase/:id/txid", creditsHandler.SubmitTxId)
	creditsGroup.POST("/purchase/:id/blik", creditsHandler.UpdateBlikCode)
	creditsGroup.GET("/purchase", creditsHandler.ListPurchases)
	creditsGroup.GET("/purchase/:id/blik", creditsHandler.BlikWebSocket)

	// User-scoped routes (rate: user)
	usr := api.Group("", userRL)
	usr.POST("/purchases", purchasesHandler.Create, authMW.Authenticate, authMW.RequireEmailVerified)
	usr.GET("/purchases", purchasesHandler.List, authMW.Authenticate)

	favGroup := api.Group("/favorites", userRL, authMW.Authenticate)
	favGroup.POST("", favoritesHandler.Toggle)
	favGroup.GET("", favoritesHandler.List)
	favGroup.GET("/:contentItemId/details", favoritesHandler.GetDetails)
	favGroup.POST("/check", favoritesHandler.BatchCheck)

	notifGroup := api.Group("/notifications", userRL, authMW.Authenticate)
	notifGroup.GET("", notifHandler.List)
	notifGroup.GET("/stream", notifHandler.Stream)
	notifGroup.PATCH("", notifHandler.MarkAllRead)

	usr.GET("/user/balance", userHandler.GetBalance, authMW.Authenticate)
	usr.GET("/user/profile", userHandler.GetProfile, authMW.Authenticate)
	usr.PATCH("/user/profile", userHandler.UpdateProfile, authMW.Authenticate)
	usr.PATCH("/user/email", userHandler.UpdateEmail, authMW.Authenticate)
	usr.PATCH("/user/password", userHandler.UpdatePassword, authMW.Authenticate)
	usr.PATCH("/user/autoplay", userHandler.UpdateAutoplay, authMW.Authenticate)
	usr.GET("/user/preferences", userHandler.GetPreferences, authMW.Authenticate)
	usr.GET("/referral/me", referralHandler.GetMe, authMW.Authenticate)

	// ── Admin routes (requires auth + admin) ─────────────────────────────
	adminGroup := api.Group("/admin", adminRL, authMW.Authenticate, adminMW.RequireAdmin)
	adminHandler := admin.NewHandler(pgPool, r2Client, r2ProofClient, cfg, redisClient, contentService, mailService)

	adminGroup.GET("/credits/purchases", adminHandler.ListCreditPurchases)
	adminGroup.GET("/credits/purchases/stream", adminHandler.StreamPendingPurchases)
	adminGroup.GET("/credits/purchases/:id/proof", adminHandler.GetPurchaseProof)
	adminGroup.POST("/credits/purchases/:id/approve", adminHandler.ApprovePurchase)
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

	// ── Health check ─────────────────────────────────────────────────────
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
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
	log.Println("Server exited cleanly")
}
