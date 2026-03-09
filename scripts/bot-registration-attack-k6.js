/**
 * Symulacja ataku bota: masowe zakładanie kont bez tokenu Turnstile
 *
 * Uruchom:
 *   k6 run scripts/bot-registration-attack-k6.js
 *
 * Oczekiwany wynik po dodaniu Cloudflare Turnstile:
 *   - 0 sukesów rejestracji
 *   - 100% odpowiedzi 400/422 z komunikatem o braku/błędnym captcha
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://dyskiof.net';

// Liczniki wyników
const successCount = new Counter('registrations_success');
const blockedCount = new Counter('registrations_blocked');
const errorCount = new Counter('registrations_error');

export const options = {
    // 100 wirtualnych użytkowników, każdy rejestruje jedno konto
    scenarios: {
        bot_attack: {
            executor: 'shared-iterations',
            vus: 20,          // 20 równoległych wątków
            iterations: 100,  // łącznie 100 prób
            maxDuration: '2m',
        },
    },
    thresholds: {
        // Test "zdany" jeśli żadna rejestracja się NIE powiodła
        registrations_success: ['count == 0'],
        registrations_blocked: ['count == 100'],
    },
};

// Prosty generator unikalnych danych
function randomEmail(i) {
    return `bot_test_${__VU}_${i}_${Date.now()}@tempmail.com`;
}

function randomUsername(i) {
    return `bot_${__VU}_${i}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function () {
    const iter = __ITER;

    const payload = JSON.stringify({
        email: randomEmail(iter),
        username: randomUsername(iter),
        password: 'SuperSecret123!',
        // ❌ Celowo brak pola captchaToken / turnstileToken
    });

    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; BotTest/1.0)',
        'Origin': BASE,
        'Referer': `${BASE}/register`,
    };

    const res = http.post(`${BASE}/api/auth/register`, payload, { headers });

    const status = res.status;
    let body = '';
    try { body = JSON.parse(res.body); } catch (_) { }

    // Kategoryzacja wyniku
    if (status === 200 || status === 201) {
        successCount.add(1);
        console.warn(`⚠️  SUKCES rejestracji! VU=${__VU} iter=${iter} → CAPTCHA NIE chroni!`);

    } else if (status === 400 || status === 401 || status === 403 || status === 422) {
        blockedCount.add(1);
        // Sprawdź czy to błąd captcha
        const isCaptchaBlock =
            check(res, {
                'zablokowany przez captcha': (r) =>
                    r.body.toLowerCase().includes('captcha') ||
                    r.body.toLowerCase().includes('turnstile') ||
                    r.body.toLowerCase().includes('token') ||
                    r.body.toLowerCase().includes('bot'),
            });

        if (!isCaptchaBlock) {
            // Zablokowany ale z innego powodu (np. walidacja pól)
            console.log(`ℹ️  Błąd walidacji (nie captcha): ${status} → ${res.body.slice(0, 120)}`);
        }

    } else if (status === 429) {
        blockedCount.add(1);
        check(res, { 'rate limited (429)': () => true });
        console.log(`🛑 Rate limit: VU=${__VU} iter=${iter}`);

    } else {
        errorCount.add(1);
        console.error(`❓ Nieoczekiwany status: ${status} → ${res.body.slice(0, 120)}`);
    }

    sleep(0.1); // 100ms przerwa między próbami
}

export function handleSummary(data) {
    const success = data.metrics['registrations_success']?.values?.count ?? 0;
    const blocked = data.metrics['registrations_blocked']?.values?.count ?? 0;
    const errors = data.metrics['registrations_error']?.values?.count ?? 0;

    const verdict = success === 0
        ? '✅ CAPTCHA DZIAŁA – żadna rejestracja bota się nie powiodła!'
        : `🚨 UWAGA: ${success} rejestracji przeszło pomimo captchy!`;

    return {
        stdout: `
╔══════════════════════════════════════════════════╗
║     WYNIKI TESTU: Atak masowej rejestracji       ║
╠══════════════════════════════════════════════════╣
║  Zablokowane próby:  ${String(blocked).padEnd(28)}║
║  Udane rejestracje:  ${String(success).padEnd(28)}║
║  Błędy sieciowe:     ${String(errors).padEnd(28)}║
╠══════════════════════════════════════════════════╣
║  ${verdict.padEnd(49)}║
╚══════════════════════════════════════════════════╝
`,
    };
}
