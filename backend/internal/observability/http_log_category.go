package observability

import "strings"

// HTTP log bucket for Loki/Grafana: operator-facing API vs public app traffic vs the rest.
//
//	server — /api/admin/* (R2 sync, import, moderacja, approval proofów, …)
//	user   — pozostałe /api/* (content, purchase, auth, modele, …)
//	misc   — /health, brak trasy, nietypiczne ścieżki
func HTTPLogCategory(echoPath string) string {
	p := echoPath
	if p == "" {
		return "misc"
	}
	if p == "/health" {
		return "misc"
	}
	if strings.HasPrefix(p, "/api/admin/") {
		return "server"
	}
	if strings.HasPrefix(p, "/api/") {
		return "user"
	}
	return "misc"
}
