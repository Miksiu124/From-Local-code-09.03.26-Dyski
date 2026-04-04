package growth

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

var logToStdout bool

func init() {
	logToStdout = os.Getenv("GROWTH_EVENTS") == "1" || os.Getenv("ENVIRONMENT") == "production"
}

// EmitJSON logs a copy of the stored funnel payload for log pipelines / BI (no PII).
func EmitJSON(eventName string, userID *string, props map[string]interface{}) {
	if !logToStdout {
		return
	}
	payload := map[string]interface{}{
		"ts":         time.Now().UTC().Format(time.RFC3339Nano),
		"event_name": eventName,
		"user_id":    userID,
		"props":      props,
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	log.Printf("[GROWTH] %s", string(b))
}
