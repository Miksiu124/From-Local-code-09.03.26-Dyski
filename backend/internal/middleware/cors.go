package middleware

import (
	"content-platform-backend/internal/config"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
)

func CORSMiddleware(cfg *config.Config) echo.MiddlewareFunc {
	allowOrigins := []string{cfg.FrontendURL}
	if !cfg.IsProduction() {
		allowOrigins = append(allowOrigins, "http://localhost:3000", "http://localhost:3001")
	}

	return echomw.CORSWithConfig(echomw.CORSConfig{
		AllowOrigins:     allowOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Accept", "Authorization", "Content-Type", "X-Requested-With"},
		AllowCredentials: true,
		MaxAge:           3600,
	})
}
