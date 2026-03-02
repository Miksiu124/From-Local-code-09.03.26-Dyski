package geo

import (
	"content-platform-backend/internal/common"
	"github.com/labstack/echo/v4"
)

type Handler struct{}

func NewHandler() *Handler {
	return &Handler{}
}

// GetUserCountry returns country and locale based on IP (Cloudflare CF-IPCountry header).
func (h *Handler) GetUserCountry(c echo.Context) error {
	country := c.Request().Header.Get("CF-IPCountry")
	if country == "" || country == "XX" {
		country = "PL"
	}
	locale := "pl"
	switch country {
	case "DE", "AT", "CH":
		locale = "de"
	case "US", "GB", "AU", "CA":
		locale = "en"
	}
	return common.Success(c, map[string]string{"country": country, "locale": locale})
}
