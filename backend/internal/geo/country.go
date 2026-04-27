package geo

import (
	"strings"

	"github.com/labstack/echo/v4"
)

// CountryFromEcho returns ISO 3166-1 alpha-2 from Cloudflare CF-IPCountry when the client
// reached the API through Cloudflare. Empty string if the header is missing or not a country code.
func CountryFromEcho(c echo.Context) string {
	if c == nil {
		return ""
	}
	cc := strings.ToUpper(strings.TrimSpace(c.Request().Header.Get("CF-IPCountry")))
	switch {
	case cc == "", cc == "XX", cc == "T1": // T1 = Tor (CF)
		return ""
	case len(cc) == 2 && cc[0] >= 'A' && cc[0] <= 'Z' && cc[1] >= 'A' && cc[1] <= 'Z':
		return cc
	default:
		return ""
	}
}
