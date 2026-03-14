#!/usr/bin/env python3
"""
Skrypt do usuwania '_source' z nazw plików w R2 (np. xxx_source.jpg -> xxx.jpg).
Użycie:
  pip install boto3
  # Ustaw zmienne z .env (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT)
  python scripts/rename-r2-source-photos.py nikita.alokin [--dry-run]
"""

import os
import sys
import argparse
from datetime import datetime, timezone

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("Zainstaluj boto3: pip install boto3")
    sys.exit(1)


def load_env():
    """Ładuj .env jeśli istnieje (prosty parser)."""
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


def main():
    load_env()

    parser = argparse.ArgumentParser(description="Usuń _source z nazw plików w R2")
    parser.add_argument("folder", nargs="?", default="", help="Prefix folderu (np. nikita.alokin)")
    parser.add_argument("--dry-run", action="store_true", help="Tylko podgląd, bez zmian")
    parser.add_argument("--list-jpg", action="store_true", help="Wypisz pierwsze 30 plikow .jpg (debug)")
    parser.add_argument("--proof", action="store_true", help="Uzyj R2_PROOF_* (inny bucket)")
    parser.add_argument("--date", metavar="YYYY-MM-DD", help="Tylko pliki zmodyfikowane tego dnia (np. 2026-03-06)")
    parser.add_argument("--list-prefixes", action="store_true", help="Wypisz foldery (prefixy) w buckecie")
    args = parser.parse_args()

    if args.proof:
        access_key = os.environ.get("R2_PROOF_ACCESS_KEY_ID") or os.environ.get("R2_ACCESS_KEY_ID")
        secret_key = os.environ.get("R2_PROOF_SECRET_ACCESS_KEY") or os.environ.get("R2_SECRET_ACCESS_KEY")
        bucket = os.environ.get("R2_PROOF_BUCKET_NAME") or os.environ.get("R2_BUCKET_NAME")
        endpoint = os.environ.get("R2_PROOF_ENDPOINT") or os.environ.get("R2_ENDPOINT")
        account_id = os.environ.get("R2_ACCOUNT_ID")
        if bucket:
            print("Uzywam R2_PROOF_* (bucket:", bucket, ")")
    else:
        access_key = os.environ.get("R2_ACCESS_KEY_ID")
        secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
        bucket = os.environ.get("R2_BUCKET_NAME")
        endpoint = os.environ.get("R2_ENDPOINT")
        account_id = os.environ.get("R2_ACCOUNT_ID")

    if not all([access_key, secret_key, bucket]):
        print("Ustaw R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME (np. z .env)")
        print("Dla innego bucketa: dodaj --proof i ustaw R2_PROOF_*")
        sys.exit(1)

    if not endpoint and account_id:
        endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    if not endpoint:
        print("Ustaw R2_ENDPOINT lub R2_ACCOUNT_ID")
        sys.exit(1)

    prefix = args.folder.rstrip("/") + "/" if args.folder else ""

    if args.list_prefixes:
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        paginator = s3.get_paginator("list_objects_v2")
        prefixes = set()
        for page in paginator.paginate(Bucket=bucket, Delimiter="/"):
            for p in page.get("CommonPrefixes", []):
                if p.get("Prefix"):
                    prefixes.add(p["Prefix"])
        print("Foldery w buckecie:", sorted(prefixes)[:50])
        if len(prefixes) > 50:
            print("... i", len(prefixes) - 50, "wiecej")
        return

    filter_date = None
    if args.date:
        try:
            filter_date = datetime.strptime(args.date, "%Y-%m-%d").date()
            print(f"Filtr daty: tylko pliki z {filter_date}")
        except ValueError:
            print("Nieprawidlowy format daty. Uzyj YYYY-MM-DD (np. 2026-03-06)")
            sys.exit(1)

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    # Pliki do zmiany: xxx_source.jpg -> xxx.jpg (tylko zdjecia, nie thumbnails video)
    suffixes = ("_source.jpg", "_source.png", "_source.webp")
    # NIE zmieniamy: xxx_source_thumbnail.webp (to miniatury filmow)
    renamed = 0
    jpg_samples = [] if args.list_jpg else None
    errors = 0
    total = 0
    sample_keys = []
    count_source_jpg = 0
    count_date_match = 0
    date_match_samples = []

    print(f"Szukam plikow w s3://{bucket}/{prefix}...")
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            total += 1
            key = obj["Key"]
            # Filtr po dacie modyfikacji
            if filter_date and obj.get("LastModified"):
                lm = obj["LastModified"]
                if lm.tzinfo is None:
                    lm = lm.replace(tzinfo=timezone.utc)
                if lm.date() != filter_date:
                    continue
                count_date_match += 1
                if key.endswith(".jpg") and len(date_match_samples) < 10:
                    date_match_samples.append(key)
            if jpg_samples is not None and key.endswith(".jpg") and len(jpg_samples) < 30:
                jpg_samples.append(key)
            if key.endswith("_source.jpg"):
                count_source_jpg += 1
                if len(sample_keys) < 5:
                    sample_keys.append(key)
            new_key = None
            for suf in suffixes:
                if key.endswith(suf) and "_thumbnail" not in key:
                    ext = suf.replace("_source", "")
                    new_key = key[: -len(suf)] + ext
                    break
            if not new_key:
                continue

            try:
                if args.dry_run:
                    print(f"[dry-run] {key} -> {new_key}")
                else:
                    s3.copy_object(
                        CopySource={"Bucket": bucket, "Key": key},
                        Bucket=bucket,
                        Key=new_key,
                    )
                    s3.delete_object(Bucket=bucket, Key=key)
                    print(f"OK: {key} -> {new_key}")
                renamed += 1
            except Exception as e:
                print(f"BŁĄD: {key}: {e}", file=sys.stderr)
                errors += 1

    if sample_keys:
        print("Przykladowe klucze *_source.jpg:", sample_keys[:5])
    if jpg_samples:
        print("\nPierwsze 30 plikow .jpg w buckecie:")
        for k in jpg_samples:
            print(" ", k)
    if filter_date:
        print(f"Plikow z data {filter_date}: {count_date_match}")
        if date_match_samples:
            print("Przyklady .jpg z tego dnia:", date_match_samples[:5])
    print(f"Plikow *_source.jpg: {count_source_jpg}")
    print(f"\nPrzeskanowano: {total} plikow. Zmieniono: {renamed}, bledow: {errors}")
    if args.dry_run:
        print("(dry-run – nic nie zmieniono, uruchom bez --dry-run aby wykonać)")


if __name__ == "__main__":
    main()
