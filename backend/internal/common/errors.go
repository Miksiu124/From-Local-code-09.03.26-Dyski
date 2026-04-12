package common

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

var uuidRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func IsValidUUID(s string) bool {
	return uuidRegex.MatchString(s)
}

// ParseUUIDParam trims whitespace, validates UUID format, and returns the canonical
// lowercase form. TEXT primary keys use case-sensitive equality in PostgreSQL; IDs
// from some clients may use uppercase A–F and must match stored lowercase rows.
func ParseUUIDParam(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if !IsValidUUID(s) {
		return "", false
	}
	return strings.ToLower(s), true
}

// ── Standard error response ─────────────────────────────────────────────────

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// HTTPRecoverError builds a safe JSON body for Echo's global HTTPErrorHandler.
// Field error is a stable machine code; message is always safe to show to users.
func HTTPRecoverError(statusCode int, echoMessage string) ErrorResponse {
	code := httpErrorCode(statusCode)
	msg := strings.TrimSpace(echoMessage)
	if msg == "" || msg == http.StatusText(statusCode) {
		msg = friendlyHTTPMessage(statusCode)
	}
	if statusCode == http.StatusInternalServerError {
		msg = "Something went wrong. Please try again."
	}
	return ErrorResponse{Error: code, Message: msg}
}

func httpErrorCode(statusCode int) string {
	switch statusCode {
	case http.StatusBadRequest:
		return "BAD_REQUEST"
	case http.StatusUnauthorized:
		return "UNAUTHORIZED"
	case http.StatusPaymentRequired:
		return "PAYMENT_REQUIRED"
	case http.StatusForbidden:
		return "FORBIDDEN"
	case http.StatusNotFound:
		return "NOT_FOUND"
	case http.StatusMethodNotAllowed:
		return "METHOD_NOT_ALLOWED"
	case http.StatusConflict:
		return "CONFLICT"
	case http.StatusGone:
		return "GONE"
	case http.StatusRequestEntityTooLarge:
		return "PAYLOAD_TOO_LARGE"
	case http.StatusUnsupportedMediaType:
		return "UNSUPPORTED_MEDIA_TYPE"
	case http.StatusUnprocessableEntity:
		return "UNPROCESSABLE_ENTITY"
	case http.StatusTooManyRequests:
		return "TOO_MANY_REQUESTS"
	case http.StatusInternalServerError:
		return "INTERNAL_ERROR"
	case http.StatusServiceUnavailable:
		return "SERVICE_UNAVAILABLE"
	default:
		return "HTTP_" + strconv.Itoa(statusCode)
	}
}

func friendlyHTTPMessage(statusCode int) string {
	switch statusCode {
	case http.StatusBadRequest:
		return "The request could not be understood. Check the data and try again."
	case http.StatusUnauthorized:
		return "Sign in to continue."
	case http.StatusForbidden:
		return "You do not have permission to do this."
	case http.StatusNotFound:
		return "Nothing was found at this address."
	case http.StatusMethodNotAllowed:
		return "This action is not allowed for this resource."
	case http.StatusConflict:
		return "This conflicts with existing data."
	case http.StatusRequestEntityTooLarge:
		return "The request body is too large."
	case http.StatusUnsupportedMediaType:
		return "This content type is not supported."
	case http.StatusUnprocessableEntity:
		return "Some fields are invalid or missing."
	case http.StatusTooManyRequests:
		return "Too many requests. Wait a moment and try again."
	case http.StatusInternalServerError:
		return "Something went wrong. Please try again."
	case http.StatusServiceUnavailable:
		return "The service is temporarily unavailable. Try again later."
	default:
		return http.StatusText(statusCode)
	}
}

func Unauthorized(c echo.Context) error {
	return c.JSON(http.StatusUnauthorized, ErrorResponse{
		Error:   "UNAUTHORIZED",
		Message: "Sign in to continue.",
	})
}

func BadRequest(c echo.Context, msg string) error {
	return c.JSON(http.StatusBadRequest, ErrorResponse{Error: msg, Message: msg})
}

func NotFound(c echo.Context, msg string) error {
	return c.JSON(http.StatusNotFound, ErrorResponse{Error: msg, Message: msg})
}

func Forbidden(c echo.Context) error {
	return c.JSON(http.StatusForbidden, ErrorResponse{
		Error:   "FORBIDDEN",
		Message: "You do not have permission to do this.",
	})
}

func TooManyRequests(c echo.Context) error {
	return c.JSON(http.StatusTooManyRequests, ErrorResponse{
		Error:   "TOO_MANY_REQUESTS",
		Message: "Too many requests. Wait a moment and try again.",
	})
}

// RateLimited returns 429 with Retry-After header (RFC 7231).
func RateLimited(c echo.Context, retryAfterSeconds int, message string) error {
	return RateLimitedJSON(c, retryAfterSeconds, "RATE_LIMITED", message)
}

// RateLimitedJSON returns 429 with Retry-After and custom error code.
func RateLimitedJSON(c echo.Context, retryAfterSeconds int, errorCode, message string) error {
	if retryAfterSeconds < 1 {
		retryAfterSeconds = 1
	}
	c.Response().Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
	return c.JSON(http.StatusTooManyRequests, ErrorResponse{Error: errorCode, Message: message})
}

func InternalError(c echo.Context) error {
	return c.JSON(http.StatusInternalServerError, ErrorResponse{
		Error:   "INTERNAL_ERROR",
		Message: "Something went wrong. Please try again.",
	})
}

// InvalidCredentials is used by login when email/password do not match.
// Error string stays "Invalid credentials" for clients that branch on it; Message is empty so UIs can translate.
func InvalidCredentials(c echo.Context) error {
	return c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "Invalid credentials"})
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
