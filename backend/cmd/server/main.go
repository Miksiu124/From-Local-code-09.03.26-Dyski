package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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
	"content-platform-backend/internal/jobs"
	"content-platform-backend/internal/models"
	"content-platform-backend/internal/notifications"
	"content-platform-backend/internal/purchases"
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

	// Global middleware
	e.Use(echomw.Recover())
	e.Use(echomw.RequestID())
	e.Use(echomw.Logger())
	e.Use(middleware.CORSMiddleware(cfg))
	e.Use(echomw.Secure())
	e.Use(echomw.BodyLimit("2M"))

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
	contentService := content.NewService(pgPool, r2Client, cfg)

	// ── Auth middleware ──────────────────────────────────────────────────
	authMW := middleware.NewAuthMiddleware(cfg, redisClient, pgPool)
	adminMW := middleware.NewAdminMiddleware(cfg)

    // ── Jobs ─────────────────────────────────────────────────────────────
    scheduler := jobs.NewScheduler()
    // Run sync immediately on startup
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("[PANIC] RunFullSync crashed: %v", r)
            }
        }()
        contentService.RunFullSync()
    }()
    // Then run sync every hour
    _, err = scheduler.AddJob("@hourly", func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("[PANIC] Scheduled RunFullSync crashed: %v", r)
            }
        }()
        contentService.RunFullSync()
    })
    if err != nil {
        log.Printf("Failed to schedule R2 sync: %v", err)
    }
    scheduler.Start()
    defer scheduler.Stop()

	// ── Rate limiter ─────────────────────────────────────────────────────
	rateLimiter := middleware.NewRateLimiter(redisClient)

	// ── Routes ───────────────────────────────────────────────────────────
	api := e.Group("/api")

	// Mailer
	mailService := mailer.New(cfg)

	// Auth routes (public)
	authHandler := auth.NewHandler(authService, cfg, rateLimiter, mailService, redisClient)
	authGroup := api.Group("/auth")
	authGroup.POST("/register", authHandler.Register)
	authGroup.POST("/login", authHandler.Login)
	authGroup.POST("/logout", authHandler.Logout)
	authGroup.GET("/me", authHandler.Me, authMW.Authenticate)
	authGroup.POST("/forgot-password", authHandler.ForgotPassword)
	authGroup.POST("/reset-password", authHandler.ResetPassword)
	authGroup.GET("/discord", authHandler.DiscordRedirect)
	authGroup.GET("/discord/callback", authHandler.DiscordCallback)

	// Models (public)
	modelsHandler := models.NewHandler(pgPool)
	api.GET("/models", modelsHandler.List)
	api.GET("/models/stats", modelsHandler.GetStats) // Added
	api.GET("/models/:slug", modelsHandler.GetBySlug)
	api.GET("/models/:slug/content", modelsHandler.ListContent) // Added pagination endpoint
	api.GET("/models/:modelId/access", modelsHandler.CheckAccess, authMW.OptionalAuth)

	// Meta & Helpers
	geoHandler := geo.NewHandler()
	api.GET("/geo/country", geoHandler.GetUserCountry)
	api.GET("/countries", modelsHandler.ListCountries)
	api.GET("/settings/public", modelsHandler.GetPublicSettings)
	api.GET("/user/access", modelsHandler.GetUserAccess, authMW.OptionalAuth)

	// Content streaming (requires auth + access)
	contentHandler := content.NewHandler(pgPool, r2Client, cfg)
	
	// Model images (public)
	api.GET("/models/:slug/avatar", contentHandler.ModelAvatar)
	api.GET("/models/:slug/header", contentHandler.ModelHeader)
	api.GET("/models/:slug/thumbnail", contentHandler.ModelAvatar)

	contentGroup := api.Group("/content")
	contentGroup.GET("/:slug/:contentItemId/details", contentHandler.GetContentDetails, authMW.OptionalAuth)
	contentGroup.GET("/:id/thumbnail", contentHandler.Thumbnail, authMW.OptionalAuth)
	contentGroup.GET("/:id/thumbnail/:filename", contentHandler.Thumbnail, authMW.OptionalAuth)
	contentGroup.GET("/:id/playlist/:filename", contentHandler.Playlist, authMW.Authenticate)
	contentGroup.GET("/:id/segment/:filename", contentHandler.Segment) // token-validated

	// Credits (requires auth)
	creditsHandler := credits.NewHandler(pgPool, redisClient, cfg, r2Client)
	creditsGroup := api.Group("/credits", authMW.Authenticate)
	creditsGroup.POST("/purchase", creditsHandler.CreatePurchase)
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
	api.POST("/purchases", purchasesHandler.Create, authMW.Authenticate)
    api.GET("/purchases", purchasesHandler.List, authMW.Authenticate) // Added List

	// Favorites (requires auth)
	favoritesHandler := favorites.NewHandler(pgPool)
	favGroup := api.Group("/favorites", authMW.Authenticate)
	favGroup.POST("", favoritesHandler.Toggle)
	favGroup.GET("", favoritesHandler.List)
	favGroup.POST("/check", favoritesHandler.BatchCheck)

	// Notifications (requires auth)
	notifHandler := notifications.NewHandler(pgPool, redisClient)
	notifGroup := api.Group("/notifications", authMW.Authenticate)
	notifGroup.GET("", notifHandler.List)
	notifGroup.GET("/stream", notifHandler.Stream)
	notifGroup.PATCH("", notifHandler.MarkAllRead)

	// User (requires auth)
	userHandler := user.NewHandler(pgPool)
	api.GET("/user/balance", userHandler.GetBalance, authMW.Authenticate)
	api.GET("/user/profile", userHandler.GetProfile, authMW.Authenticate)
	api.PATCH("/user/profile", userHandler.UpdateProfile, authMW.Authenticate)
	api.PATCH("/user/email", userHandler.UpdateEmail, authMW.Authenticate)
	api.PATCH("/user/password", userHandler.UpdatePassword, authMW.Authenticate)
	api.PATCH("/user/autoplay", userHandler.UpdateAutoplay, authMW.Authenticate)
	api.GET("/user/preferences", userHandler.GetPreferences, authMW.Authenticate)

	// ── Admin routes (requires auth + admin) ─────────────────────────────
	adminGroup := api.Group("/admin", authMW.Authenticate, adminMW.RequireAdmin)
	adminHandler := admin.NewHandler(pgPool, r2Client, cfg, redisClient, contentService, mailService)

	adminGroup.GET("/credits/purchases", adminHandler.ListCreditPurchases)
	adminGroup.GET("/credits/purchases/stream", adminHandler.StreamPendingPurchases)
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
	adminGroup.GET("/models", adminHandler.ListModels)
	adminGroup.PATCH("/models", adminHandler.UpdateModel)
	adminGroup.PATCH("/content/hidden", adminHandler.ToggleContentHidden)
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
