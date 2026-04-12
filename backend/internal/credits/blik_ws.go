package credits

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

const blikTimerSeconds = 110
const blikWSMaxRetries = 5

type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

func (h *Handler) newUpgrader() websocket.Upgrader {
	allowedOrigin := h.cfg.FrontendURL
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return false
			}
			parsed, err := url.Parse(origin)
			if err != nil {
				return false
			}
			allowed, err := url.Parse(allowedOrigin)
			if err != nil {
				return false
			}
			return strings.EqualFold(parsed.Host, allowed.Host)
		},
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
	}
}

// BlikWebSocket handles the BLIK payment timer loop.
//
// Flow:
//  1. User connects with a valid credit purchase ID
//  2. Server starts a 110s timer
//  3. Admin approves via REST endpoint -> publishes to Redis
//  4. If timer expires -> send REQUEST_NEW_CODE -> user sends new code -> restart
//  5. If admin approves -> send APPROVED -> close
func (h *Handler) BlikWebSocket(c echo.Context) error {
	userID := middleware.GetUserID(c)
	purchaseID, uuidOK := common.ParseUUIDParam(c.Param("id"))

	if userID == "" {
		return common.Unauthorized(c)
	}
	if !uuidOK {
		return common.JSONError(c, http.StatusBadRequest, "INVALID_PURCHASE_ID", "Purchase ID is not valid.")
	}

	// Verify purchase belongs to user and is PENDING BLIK
	var status, paymentMethod string
	err := h.db.QueryRow(c.Request().Context(), `
		SELECT status, payment_method FROM credit_purchases
		WHERE id = $1 AND user_id = $2
	`, purchaseID, userID).Scan(&status, &paymentMethod)
	if err != nil {
		return common.JSONError(c, http.StatusNotFound, "PURCHASE_NOT_FOUND", "No purchase matches this link.")
	}
	if paymentMethod != "BLIK" {
		return common.JSONError(c, http.StatusBadRequest, "NOT_BLIK_PURCHASE", "This purchase is not using BLIK.")
	}
	if status != "PENDING" {
		return common.JSONError(c, http.StatusBadRequest, "PURCHASE_NOT_PENDING", "This purchase is no longer pending.")
	}

	upgrader := h.newUpgrader()
	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return nil
	}
	defer ws.Close()

	sendWSMessage(ws, "CONNECTED", map[string]interface{}{
		"purchaseId": purchaseID,
		"timerSecs":  blikTimerSeconds,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	channel := fmt.Sprintf("blik:%s", purchaseID)
	pubsub := h.redis.Subscribe(ctx, channel)
	defer pubsub.Close()

	redisCh := pubsub.Channel()

	// Single persistent reader goroutine to avoid leaking goroutines per loop iteration.
	clientCh := make(chan []byte, 1)
	go func() {
		defer cancel()
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				return
			}
			select {
			case clientCh <- msg:
			case <-ctx.Done():
				return
			}
		}
	}()

	wsRetryCount := 0

	for {
		timer := time.NewTimer(time.Duration(blikTimerSeconds) * time.Second)
		sendWSMessage(ws, "TIMER_STARTED", map[string]int{"seconds": blikTimerSeconds})

		select {
		case msg := <-redisCh:
			timer.Stop()
			var action struct {
				Action string `json:"action"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &action); err == nil {
				if action.Action == "APPROVED" {
					sendWSMessage(ws, "APPROVED", nil)
					return nil
				} else if action.Action == "REJECTED" {
					sendWSMessage(ws, "REJECTED", nil)
					return nil
				}
			}

		case <-timer.C:
			wsRetryCount++

			if wsRetryCount > blikWSMaxRetries {
				sendWSMessage(ws, "MAX_RETRIES", map[string]string{
					"message": "Maximum BLIK code attempts reached",
				})
				return nil
			}

			_, _ = h.db.Exec(ctx, `
				UPDATE credit_purchases 
				SET retry_count = retry_count + 1,
				    expiration_time = now() + ($1 || ' minutes')::interval
				WHERE id = $2
			`, fmt.Sprintf("%d", h.cfg.BlikExpirationMinutes), purchaseID)

			sendWSMessage(ws, "REQUEST_NEW_CODE", map[string]string{
				"message": "BLIK code expired. Please enter a new code.",
			})

			select {
			case clientMsg := <-clientCh:
				var newCode struct {
					BlikCode string `json:"blikCode"`
				}
				if err := json.Unmarshal(clientMsg, &newCode); err == nil && len(newCode.BlikCode) >= 6 {
					_, _ = h.db.Exec(ctx, `
						UPDATE credit_purchases SET blik_code = $1 WHERE id = $2
					`, newCode.BlikCode, purchaseID)

					sendWSMessage(ws, "CODE_UPDATED", map[string]string{
						"blikCode": newCode.BlikCode,
					})
				} else {
					sendWSMessage(ws, "ERROR", map[string]string{
						"message": "Invalid BLIK code",
					})
				}

			case <-time.After(5 * time.Minute):
				sendWSMessage(ws, "TIMEOUT", nil)
				return nil

			case <-ctx.Done():
				return nil
			}

		case <-clientCh:
			timer.Stop()

		case <-ctx.Done():
			timer.Stop()
			return nil
		}
	}
}

func sendWSMessage(ws *websocket.Conn, msgType string, payload interface{}) {
	msg := WSMessage{Type: msgType, Payload: payload}
	data, _ := json.Marshal(msg)
	_ = ws.WriteMessage(websocket.TextMessage, data)
}
