package credits

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"content-platform-backend/internal/middleware"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS is handled by middleware
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

const blikTimerSeconds = 110

type WSMessage struct {
	Type    string `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

// BlikWebSocket handles the BLIK payment timer loop
// Flow:
//  1. User connects with a valid credit purchase ID
//  2. Server starts a 110s timer
//  3. Admin approves via REST endpoint → publishes to Redis
//  4. If timer expires → send REQUEST_NEW_CODE → user sends new code → restart
//  5. If admin approves → send APPROVED → close
func (h *Handler) BlikWebSocket(c echo.Context) error {
	userID := middleware.GetUserID(c)
	purchaseID := c.Param("id")

	if userID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	}

	// Verify purchase belongs to user and is PENDING BLIK
	var status, paymentMethod string
	err := h.db.QueryRow(c.Request().Context(), `
		SELECT status, payment_method FROM credit_purchases
		WHERE id = $1 AND user_id = $2
	`, purchaseID, userID).Scan(&status, &paymentMethod)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Purchase not found"})
	}
	if paymentMethod != "BLIK" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Not a BLIK purchase"})
	}
	if status != "PENDING" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Purchase is not pending"})
	}

	// Upgrade to WebSocket
	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return nil
	}
	defer ws.Close()

	// Send initial status
	sendWSMessage(ws, "CONNECTED", map[string]interface{}{
		"purchaseId": purchaseID,
		"timerSecs":  blikTimerSeconds,
	})

	// Subscribe to Redis Pub/Sub for this purchase
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	channel := fmt.Sprintf("blik:%s", purchaseID)
	pubsub := h.redis.Subscribe(ctx, channel)
	defer pubsub.Close()

	redisCh := pubsub.Channel()

	// Main loop
	for {
		// Start timer
		timer := time.NewTimer(time.Duration(blikTimerSeconds) * time.Second)
		sendWSMessage(ws, "TIMER_STARTED", map[string]int{"seconds": blikTimerSeconds})

		// Wait for either:
		// 1. Admin action via Redis Pub/Sub
		// 2. Timer expiry
		// 3. Client message (new BLIK code)
		// 4. Connection close

		clientCh := make(chan []byte, 1)
		go func() {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				cancel()
				return
			}
			clientCh <- msg
		}()

		select {
		case msg := <-redisCh:
			timer.Stop()
			// Admin action received
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
			// Timer expired — request new code
			// Increment retry count
			_, _ = h.db.Exec(context.Background(), `
				UPDATE credit_purchases 
				SET retry_count = retry_count + 1,
				    expiration_time = now() + ($1 || ' minutes')::interval
				WHERE id = $2
			`, fmt.Sprintf("%d", h.cfg.BlikExpirationMinutes), purchaseID)

			sendWSMessage(ws, "REQUEST_NEW_CODE", map[string]string{
				"message": "BLIK code expired. Please enter a new code.",
			})

			// Wait for client to send new code
			select {
			case clientMsg := <-clientCh:
				var newCode struct {
					BlikCode string `json:"blikCode"`
				}
				if err := json.Unmarshal(clientMsg, &newCode); err == nil && len(newCode.BlikCode) >= 6 {
					// Update the BLIK code in purchase
					_, _ = h.db.Exec(context.Background(), `
						UPDATE credit_purchases SET blik_code = $1 WHERE id = $2
					`, newCode.BlikCode, purchaseID)

					sendWSMessage(ws, "CODE_UPDATED", map[string]string{
						"blikCode": newCode.BlikCode,
					})
					// Continue loop — timer restarts
				} else {
					sendWSMessage(ws, "ERROR", map[string]string{
						"message": "Invalid BLIK code",
					})
				}

			case <-time.After(5 * time.Minute):
				// No response in 5 minutes — close
				sendWSMessage(ws, "TIMEOUT", nil)
				return nil

			case <-ctx.Done():
				return nil
			}

		case <-clientCh:
			// Unexpected client message during timer — ignore
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
