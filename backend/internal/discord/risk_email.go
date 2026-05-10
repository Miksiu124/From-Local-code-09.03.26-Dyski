package discord

import "strings"

var disposableDomains = map[string]struct{}{
	"10minutemail.com":       {},
	"guerrillamail.com":      {},
	"guerrillamail.de":       {},
	"guerrillamail.net":      {},
	"guerrillamailblock.com": {},
	"grr.la":                 {},
	"mailinator.com":         {},
	"maildrop.cc":            {},
	"tempmail.com":           {},
	"temp-mail.org":          {},
	"throwaway.email":        {},
	"yopmail.com":            {},
	"yopmail.fr":             {},
	"sharklasers.com":        {},
	"guerrillamail.info":     {},
	"dispostable.com":        {},
	"mailnesia.com":          {},
	"trashmail.com":          {},
	"trashmail.me":           {},
	"trashmail.net":          {},
	"tempail.com":            {},
	"tempr.email":            {},
	"discard.email":          {},
	"fakeinbox.com":          {},
	"mailcatch.com":          {},
	"mintemail.com":          {},
	"mohmal.com":             {},
	"burnermail.io":          {},
	"harakirimail.com":       {},
	"mailnull.com":           {},
	"jetable.org":            {},
	"nada.email":             {},
	"getnada.com":            {},
	"emailondeck.com":        {},
	"33mail.com":             {},
	"inboxkitten.com":        {},
	"mytemp.email":           {},
	"tmpmail.net":            {},
	"tmpmail.org":            {},
	"boun.cr":                {},
	"filzmail.com":           {},
	"mailexpire.com":         {},
	"tempinbox.com":          {},
	"trash-mail.com":         {},
	"mailsac.com":            {},
	"tmail.ws":               {},
	"spamgourmet.com":        {},
	"getairmail.com":         {},
	"crazymailing.com":       {},
	"mailforspam.com":        {},
}

func IsRiskEmail(email string) bool {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 {
		return false
	}
	domain := strings.ToLower(strings.TrimSpace(parts[1]))
	_, found := disposableDomains[domain]
	return found
}
