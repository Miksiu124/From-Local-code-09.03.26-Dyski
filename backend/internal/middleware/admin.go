package middleware

import (
	"net/http"

	"content-platform-backend/internal/config"

	"github.com/labstack/echo/v4"
)

type AdminMiddleware struct {
	cfg *config.Config
}

func NewAdminMiddleware(cfg *config.Config) *AdminMiddleware {
	return &AdminMiddleware{cfg: cfg}
}

func (am *AdminMiddleware) RequireAdmin(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		role := GetUserRole(c)
		email := GetUserEmail(c)

		if role != "ADMIN" && !am.cfg.IsAdmin(email) {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "Forbidden"})
		}
		return next(c)
	}
}
