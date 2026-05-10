package growth

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// ErrInvalidEventName is returned when the funnel label does not match ValidEventName.
var ErrInvalidEventName = errors.New("invalid event name")

var eventNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,127}$`)

// ValidEventName returns true if event is a safe lowercase funnel label (e.g. session_start).
func ValidEventName(name string) bool {
	name = strings.TrimSpace(strings.ToLower(name))
	return eventNameRe.MatchString(name)
}

// ExecPool is satisfied by *pgxpool.Pool and other types that can run Exec.
type ExecPool interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// InsertEvent persists a funnel event. No raw email/password/tokens in props (sanitized).
func InsertEvent(ctx context.Context, db ExecPool, eventName string, userID *string, props map[string]interface{}) error {
	if db == nil {
		return nil
	}
	eventName = strings.TrimSpace(strings.ToLower(eventName))
	if !ValidEventName(eventName) {
		return ErrInvalidEventName
	}
	if props == nil {
		props = map[string]interface{}{}
	}
	sanitizeProps(props)
	b, err := json.Marshal(props)
	if err != nil {
		b = []byte("{}")
	}
	if len(b) > 8192 {
		b = []byte(`{"_truncated":true}`)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO growth_events (event_name, user_id, props)
		VALUES ($1, $2, $3::jsonb)
	`, eventName, userID, b)
	return err
}

var blockedPropKeys = map[string]struct{}{
	"email": {}, "password": {}, "token": {}, "authorization": {},
	"cookie": {}, "session": {}, "credit_card": {}, "card": {},
}

func sanitizeProps(m map[string]interface{}) {
	for k := range m {
		lk := strings.ToLower(strings.TrimSpace(k))
		if _, bad := blockedPropKeys[lk]; bad {
			delete(m, k)
			continue
		}
		if strings.Contains(lk, "email") || strings.Contains(lk, "password") || strings.Contains(lk, "token") {
			delete(m, k)
		}
	}
}
