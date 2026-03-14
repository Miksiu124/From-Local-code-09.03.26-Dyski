/**
 * k6 load test - 100 równoczesnych streamów HLS
 *
 * Zainstaluj: https://k6.io/docs/getting-started/installation/
 * Uruchom:
 *   k6 run -e SESSION=xxx -e CONTENT_ID=uuid -e VUS=100 -e DURATION=60 scripts/load-test-streams-k6.js
 *
 * SESSION = wartość session_token z przeglądarki (DevTools → Application → Cookies)
 * CONTENT_ID = UUID filmu z URL /content/UUID
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'https://dyskiof.net';
const SESSION = __ENV.SESSION;
const CONTENT_ID = __ENV.CONTENT_ID;
const VUS = parseInt(__ENV.VUS || '100', 10);
const DURATION = __ENV.DURATION || '60';

if (!SESSION || !CONTENT_ID) {
  throw new Error('Ustaw SESSION i CONTENT_ID: k6 run -e SESSION=xxx -e CONTENT_ID=uuid ...');
}

export const options = {
  scenarios: {
    streams: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION + 's',
      startTime: '0s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    http_req_failed: ['rate<0.01'],    // Error rate under 1%
  },
};

export default function () {
  // 1. Pobierz playlistę (generuje tokeny w URLach segmentów)
  const playlistRes = http.get(
    `${BASE}/api/content/${CONTENT_ID}/playlist/master.m3u8`,
    { cookies: { session_token: SESSION } }
  );
  if (!check(playlistRes, { 'playlist 200': (r) => r.status === 200 })) {
    return;
  }

  // 2. Wyciągnij URLe - segmenty lub wariant (master-720p.m3u8)
  let segmentUrls = [];
  const lines = playlistRes.body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if ((trimmed.includes('.ts') || trimmed.includes('.m4s')) && trimmed.includes('token=')) {
      segmentUrls.push(trimmed.startsWith('http') ? trimmed : `${BASE}/api/content/${CONTENT_ID}/segment/${trimmed.split('?')[0]}?${(trimmed.split('?')[1] || '').trim()}`);
    } else if (trimmed.includes('.m3u8') && trimmed.includes('token=')) {
      // Wariant - pobierz go i wyciągnij segmenty
      const varUrl = trimmed.startsWith('http') ? trimmed : `${BASE}/api/content/${CONTENT_ID}/playlist/${trimmed.split('?')[0]}?${(trimmed.split('?')[1] || '').trim()}`;
      const varRes = http.get(varUrl, { cookies: { session_token: SESSION } });
      if (varRes.status === 200) {
        for (const vline of varRes.body.split('\n')) {
          const v = vline.trim();
          if (v && (v.includes('.ts') || v.includes('.m4s')) && v.includes('token=')) {
            segmentUrls.push(v.startsWith('http') ? v : `${BASE}/api/content/${CONTENT_ID}/segment/${v.split('?')[0]}?${(v.split('?')[1] || '').trim()}`);
          }
        }
      }
      break;
    }
  }

  if (segmentUrls.length === 0) return;

  // 3. Pobierz segmenty w pętli (symulacja odtwarzania)
  for (let i = 0; i < 8; i++) {
    const url = segmentUrls[i % segmentUrls.length];
    http.get(url, { cookies: { session_token: SESSION } });
    sleep(0.5);
  }
}
