package common

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// ── Standard error response ─────────────────────────────────────────────────

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

func Unauthorized(c echo.Context) error {
	return c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Unauthorized"})
}

func BadRequest(c echo.Context, msg string) error {
	return c.JSON(http.StatusBadRequest, ErrorResponse{Error: msg})
}

func NotFound(c echo.Context, msg string) error {
	return c.JSON(http.StatusNotFound, ErrorResponse{Error: msg})
}

func Forbidden(c echo.Context) error {
	return c.JSON(http.StatusForbidden, ErrorResponse{Error: "Forbidden"})
}

func TooManyRequests(c echo.Context) error {
	return c.JSON(http.StatusTooManyRequests, ErrorResponse{Error: "Too Many Requests"})
}

func InternalError(c echo.Context) error {
	return c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "Internal server error"})
}

func JSONError(c echo.Context, status int, errorCode, message string) error {
	return c.JSON(status, ErrorResponse{Error: errorCode, Message: message})
}

// ── Success helpers ─────────────────────────────────────────────────────────

func Success(c echo.Context, data interface{}) error {
	return c.JSON(http.StatusOK, data)
}

func Created(c echo.Context, data interface{}) error {
	return c.JSON(http.StatusCreated, data)
}
