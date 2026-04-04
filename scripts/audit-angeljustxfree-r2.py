#!/usr/bin/env python3
"""
Audyt folderu angeljustxfree na R2.
Sprawdza: liczbę obiektów, strukturę, potencjalnie martwe pliki (bez miniatur, bez HLS).

Użycie:
  pip install boto3
  # Ustaw .env (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT)
  python scripts/audit-angeljustxfree-r2.py [--check-exists PATH1,PATH2,...]
"""

import os
import sys
from collections import defaultdict

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("Zainstaluj boto3: pip install boto3")
    sys.exit(1)

FOLDER = "angeljustxfree"


def load_env():
    """Ładuj .env jeśli istnieje."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(script_dir, "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k and v and k not in os.environ:
                        os.environ[k] = v


def get_s3_client():
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket = os.environ.get("R2_BUCKET_NAME")
    endpoint = os.environ.get("R2_ENDPOINT") or (
        f"https://{os.environ.get('R2_ACCOUNT_ID', '')}.r2.cloudflarestorage.com"
        if os.environ.get("R2_ACCOUNT_ID") else ""
    )
    if not all([access_key, secret_key, bucket]):
        print("Ustaw R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME (np. z .env)")
        sys.exit(1)
    if not endpoint:
        print("Ustaw R2_ENDPOINT lub R2_ACCOUNT_ID")
        sys.exit(1)
    return (
        boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        ),
        bucket,
    )


def classify_key(key: str) -> str:
    """Klasyfikuj klucz R2 do kategorii."""
    key_lower = key.lower()
    if "_thumbnail" in key_lower or "thumbnail." in key_lower:
        return "thumbnail"
    if ".m3u8" in key_lower:
        return "hls_playlist"
    if key_lower.endswith(".ts"):
        return "hls_segment"
    if key_lower.endswith(".mp4") or key_lower.endswith(".webm"):
        return "source_video"
    if key_lower.endswith((".jpg", ".jpeg", ".png", ".webp")) and "_source" not in key_lower and "_thumbnail" not in key_lower:
        return "photo"
    if key_lower.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return "photo_source_or_other"
    return "other"


def main():
    load_env()
    import argparse
    parser = argparse.ArgumentParser(description="Audyt angeljustxfree na R2")
    parser.add_argument("--check-exists", metavar="PATHS", help="Ścieżki do sprawdzenia (oddzielone przecinkiem)")
    parser.add_argument("--check-from-stdin", action="store_true", help="Czytaj ścieżki ze stdin (po jednej na linię)")
    parser.add_argument("--sample", type=int, default=5, help="Ile przykładowych kluczy wypisać per kategoria")
    args = parser.parse_args()

    s3, bucket = get_s3_client()

    # Tryb: sprawdź ścieżki ze stdin
    if args.check_from_stdin:
        paths = [line.strip() for line in sys.stdin if line.strip()]
        print(f"Sprawdzam {len(paths)} ścieżek w R2...\n")
        missing = []
        for path in paths:
            try:
                s3.head_object(Bucket=bucket, Key=path)
                print(f"  OK: {path}")
            except Exception:
                missing.append(path)
                print(f"  BRAK: {path}")
        if missing:
            print(f"\nBrakuje {len(missing)} plików.")
        return

    prefix = FOLDER + "/"

    print(f"=== AUDYT R2: {FOLDER} ===\n")
    print(f"Bucket: {bucket}, Prefix: {prefix}\n")

    # Lista obiektów
    by_category = defaultdict(list)
    total_size = 0
    total_count = 0

    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            size = obj.get("Size", 0)
            total_size += size
            total_count += 1
            cat = classify_key(key)
            by_category[cat].append((key, size))

    # Statystyki
    print("--- Statystyki obiektów ---")
    print(f"Łącznie obiektów: {total_count}")
    print(f"Łączny rozmiar: {total_size / (1024*1024):.1f} MB\n")

    print("--- Według kategorii ---")
    for cat in sorted(by_category.keys()):
        items = by_category[cat]
        cat_size = sum(s for _, s in items)
        print(f"  {cat}: {len(items)} plików, {cat_size / (1024*1024):.1f} MB")
        for key, _ in items[: args.sample]:
            print(f"    - {key}")
        if len(items) > args.sample:
            print(f"    ... i {len(items) - args.sample} więcej")

    # HLS: foldery z master.m3u8
    hls_folders = set()
    for key, _ in by_category["hls_playlist"]:
        if "master" in key.lower():
            parts = key.rsplit("/", 1)
            if len(parts) == 2:
                hls_folders.add(parts[0])
    print(f"\n--- Foldery HLS (z master.m3u8): {len(hls_folders)} ---")
    for f in sorted(hls_folders)[:10]:
        print(f"  {f}")
    if len(hls_folders) > 10:
        print(f"  ... i {len(hls_folders) - 10} więcej")

    # Sprawdzenie istnienia ścieżek (np. z DB)
    if args.check_exists:
        paths = [p.strip() for p in args.check_exists.split(",") if p.strip()]
        print(f"\n--- Sprawdzanie istnienia {len(paths)} ścieżek ---")
        missing = []
        for path in paths:
            try:
                s3.head_object(Bucket=bucket, Key=path)
                print(f"  OK: {path}")
            except Exception:
                missing.append(path)
                print(f"  BRAK: {path}")
        if missing:
            print(f"\nBrakuje {len(missing)} plików.")


if __name__ == "__main__":
    main()
