#!/usr/bin/env python3
"""
Load test - symulacja wielu równoczesnych streamów HLS.
Wymaga: session cookie + content ID (z przeglądarki).

Użycie:
  1. Zaloguj się na dyskiof.net, otwórz film (do którego masz dostęp)
  2. DevTools (F12) → Application → Cookies → skopiuj wartość session_token
  3. URL filmu: /content/CONTENT_ID - skopiuj CONTENT_ID (UUID)
  4. Uruchom:
     python scripts/load-test-streams.py --cookie "YOUR_JWT_TOKEN_HERE" --content-id "UUID" --streams 100 --duration 60

Zainstaluj: pip install requests
"""

import argparse
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs

try:
    import requests
except ImportError:
    print("Zainstaluj: pip install requests")
    sys.exit(1)

BASE_URL = "https://dyskiof.net"
RESULTS = {"ok": 0, "err": 0, "bytes": 0}
RESULTS_LOCK = threading.Lock()


def fetch_playlist(cookie: str, content_id: str) -> list[str]:
    """Pobiera playlistę i zwraca listę URLi segmentów z tokenami."""
    url = f"{BASE_URL}/api/content/{content_id}/playlist/master.m3u8"
    r = requests.get(url, cookies={"session_token": cookie}, timeout=10)
    if r.status_code == 401:
        raise SystemExit("Błąd 401: Nieprawidłowa sesja (wygasła?). Zaloguj się ponownie i skopiuj session_token.")
    r.raise_for_status()
    lines = r.text.split("\n")
    segment_urls = []

    def add_segment(line: str):
        if line.startswith("http"):
            segment_urls.append(line)
        elif "?" in line:
            seg_part = line.split("?")[0].strip()
            qs = line.split("?", 1)[1].strip()
            segment_urls.append(f"{BASE_URL}/api/content/{content_id}/segment/{seg_part}?{qs}")
        else:
            segment_urls.append(f"{BASE_URL}/api/content/{content_id}/segment/{line.strip()}")

    # Pełne URLe segmentów lub względne z token=
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "token=" in line and (".ts" in line or ".m4s" in line):
            add_segment(line)
        elif "/segment/" in line and "token=" in line:
            add_segment(line)

    if not segment_urls:
        # Master ma warianty (master-720p.m3u8) - pełne URLe lub względne
        for line in lines:
            if ".m3u8" in line and not line.startswith("#"):
                if line.startswith("http"):
                    var_url = line.strip()
                else:
                    variant = line.split("?")[0].strip()
                    qs = line.split("?", 1)[1].strip() if "?" in line else ""
                    var_url = f"{BASE_URL}/api/content/{content_id}/playlist/{variant}"
                    if qs:
                        var_url += "?" + qs
                vr = requests.get(var_url, cookies={"session_token": cookie}, timeout=10)
                if vr.ok:
                    for vline in vr.text.split("\n"):
                        vline = vline.strip()
                        if vline and not vline.startswith("#"):
                            if "token=" in vline and (".ts" in vline or ".m4s" in vline or "/segment/" in vline):
                                add_segment(vline)
                if segment_urls:
                    break
    return segment_urls


def fetch_segment(url: str, cookie: str) -> tuple[bool, int]:
    """Pobiera pojedynczy segment. Zwraca (sukces, bajty)."""
    try:
        r = requests.get(url, cookies={"session_token": cookie}, timeout=30, stream=True)
        if r.status_code == 200:
            size = sum(len(chunk) for chunk in r.iter_content(8192))
            return True, size
        return False, 0
    except Exception:
        return False, 0


def worker(cookie: str, segment_urls: list[str], worker_id: int, duration: float):
    """Worker symulujący jeden stream - w pętli pobiera segmenty."""
    end = time.time() + duration
    idx = 0
    while time.time() < end:
        url = segment_urls[idx % len(segment_urls)]
        ok, size = fetch_segment(url, cookie)
        with RESULTS_LOCK:
            if ok:
                RESULTS["ok"] += 1
                RESULTS["bytes"] += size
            else:
                RESULTS["err"] += 1
        idx += 1
        time.sleep(0.5)  # ~2 segmenty/sekundę na stream (segmenty ~2-6s)


def main():
    p = argparse.ArgumentParser(description="Load test HLS streams")
    p.add_argument("--cookie", required=True, help="session_token z przeglądarki")
    p.add_argument("--content-id", required=True, help="UUID content item (z URL /content/UUID)")
    p.add_argument("--streams", type=int, default=100, help="Liczba równoczesnych streamów")
    p.add_argument("--duration", type=int, default=60, help="Czas testu w sekundach")
    p.add_argument("--debug", action="store_true", help="Pokaż surową playlistę")
    args = p.parse_args()

    print(f"Pobieram playlistę dla content {args.content_id}...")
    try:
        segment_urls = fetch_playlist(args.cookie, args.content_id)
    except SystemExit:
        raise
    except Exception as e:
        print(f"Błąd: {e}")
        sys.exit(1)
    if not segment_urls:
        print("Błąd: Brak segmentów w playlistcie. Sprawdź cookie i content-id.")
        sys.exit(1)
    print(f"Znaleziono {len(segment_urls)} segmentów. Uruchamiam {args.streams} streamów na {args.duration}s...")

    start = time.time()
    with ThreadPoolExecutor(max_workers=args.streams) as ex:
        futs = [ex.submit(worker, args.cookie, segment_urls, i, args.duration) for i in range(args.streams)]
        for f in as_completed(futs):
            pass

    elapsed = time.time() - start
    print(f"\n=== Wyniki ({elapsed:.1f}s) ===")
    print(f"OK: {RESULTS['ok']}, Błędy: {RESULTS['err']}")
    print(f"Pobrane: {RESULTS['bytes'] / 1024 / 1024:.1f} MB")
    print(f"R/s: {RESULTS['ok'] / elapsed:.0f}")


if __name__ == "__main__":
    main()
