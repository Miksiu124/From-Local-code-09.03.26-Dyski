package campaigns

import (
	"encoding/json"
	"log"
	"strings"

	"content-platform-backend/internal/config"
)

func parseStringJSONMap(raw string) map[string]string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		log.Printf("[Marketing] invalid JSON map: %v", err)
		return nil
	}
	return m
}

func splitCommaTrim(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func firstNameFromDisplay(displayName string) string {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		return ""
	}
	parts := strings.Fields(displayName)
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func propBool(props map[string]interface{}, key string) bool {
	if props == nil {
		return false
	}
	v, ok := props[key]
	if !ok || v == nil {
		return false
	}
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return strings.EqualFold(strings.TrimSpace(t), "true") || t == "1"
	default:
		return false
	}
}

func siteName(cfg *config.Config) string {
	s := strings.TrimSpace(cfg.WinbackSiteName)
	if s == "" {
		return "Dyskiof"
	}
	return s
}

func ctaURL(cfg *config.Config, path string) string {
	p := strings.TrimSpace(path)
	if p == "" {
		p = "/models"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return strings.TrimRight(cfg.FrontendURL, "/") + p
}
