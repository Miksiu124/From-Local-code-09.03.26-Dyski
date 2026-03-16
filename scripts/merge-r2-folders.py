#!/usr/bin/env python3
"""
Merge folderów R2: kopiuje obiekty z folderA/ do folderB/.
Folder główny: {source}/ -> {dest}/
Avatary: avatars/{source}_avatar.webp -> avatars/{dest}_avatar.webp (tylko jeśli dest nie istnieje)

Użycie:
  pip install boto3
  python scripts/merge-r2-folders.py "emilia szymanska" emiliaszymanska [--dry-run]
  python scripts/merge-r2-folders.py --run-all  # wykonuje wszystkie merge z listy
"""

import os
import sys
import argparse

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("Zainstaluj boto3: pip install boto3")
    sys.exit(1)

# Mapowanie merge (source -> dest) - zgodnie z R2_FOLDER_MERGE_INSTRUCTIONS.md
MERGE_MAP = [
    ("emilia szymanska", "emiliaszymanska"),
    ("zuziapov", "bitchimacowsu"),
    ("abigaillutzvip", "abigaillutz"),
    ("alexbergvip", "alexberg"),
    ("angelijustx", "angeljustx"),      # 1. najpierw
    ("angeljustx", "angeljustxfree"),    # 2. potem
]


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


def object_exists(s3, bucket, key):
    """Sprawdź czy obiekt istnieje."""
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


def merge_folder(s3, bucket, source, dest, dry_run=True, overwrite=False):
    """
    Kopiuje obiekty z source/ do dest/.
    - Główny folder: source/xxx -> dest/xxx
    - Avatary: avatars/source_avatar.webp -> avatars/dest_avatar.webp (tylko jeśli dest nie ma)
    Kolizje: skip (zachowaj dest) chyba że overwrite=True.
    """
    prefix_src = source.rstrip("/") + "/"
    prefix_dest = dest.rstrip("/") + "/"

    copied = 0
    skipped_exists = 0
    errors = 0

    # 1. Główny folder
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix_src):
        for obj in page.get("Contents", []):
            src_key = obj["Key"]
            if not src_key.startswith(prefix_src):
                continue
            rel = src_key[len(prefix_src) :]
            dest_key = prefix_dest + rel

            if not overwrite and object_exists(s3, bucket, dest_key):
                skipped_exists += 1
                if skipped_exists <= 3:
                    print(f"  [skip] {dest_key} już istnieje")
                continue

            try:
                if dry_run:
                    print(f"  [dry-run] {src_key} -> {dest_key}")
                else:
                    s3.copy_object(
                        CopySource={"Bucket": bucket, "Key": src_key},
                        Bucket=bucket,
                        Key=dest_key,
                    )
                copied += 1
            except Exception as e:
                print(f"  BŁĄD: {src_key}: {e}", file=sys.stderr)
                errors += 1

    # 2. Avatary (opcjonalnie)
    avatar_keys = [
        (f"avatars/{source}_avatar.webp", f"avatars/{dest}_avatar.webp"),
        (f"avatars/{source}_header.webp", f"avatars/{dest}_header.webp"),
        (f"{prefix_src}avatar.jpg", f"{prefix_dest}avatar.jpg"),
        (f"{prefix_src}avatar.png", f"{prefix_dest}avatar.png"),
    ]
    for src_key, dest_key in avatar_keys:
        if not object_exists(s3, bucket, src_key):
            continue
        if not overwrite and object_exists(s3, bucket, dest_key):
            skipped_exists += 1
            continue
        try:
            if dry_run:
                print(f"  [dry-run] {src_key} -> {dest_key}")
            else:
                s3.copy_object(
                    CopySource={"Bucket": bucket, "Key": src_key},
                    Bucket=bucket,
                    Key=dest_key,
                )
            copied += 1
        except Exception as e:
            print(f"  BŁĄD avatar: {src_key}: {e}", file=sys.stderr)
            errors += 1

    return copied, skipped_exists, errors


def delete_folder(s3, bucket, prefix, dry_run=True):
    """Usuwa wszystkie obiekty pod prefixem."""
    prefix = prefix.rstrip("/") + "/"
    deleted = 0
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        objs = page.get("Contents", [])
        if not objs:
            continue
        keys = [o["Key"] for o in objs]
        if dry_run:
            for k in keys[:5]:
                print(f"  [dry-run] DELETE {k}")
            if len(keys) > 5:
                print(f"  [dry-run] ... i {len(keys) - 5} więcej")
        else:
            s3.delete_objects(
                Bucket=bucket,
                Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True},
            )
        deleted += len(keys)
    return deleted


def main():
    load_env()
    parser = argparse.ArgumentParser(
        description="Merge folderów R2: source -> dest (kopiuj obiekty)"
    )
    parser.add_argument("source", nargs="?", help="Folder źródłowy (A)")
    parser.add_argument("dest", nargs="?", help="Folder docelowy (B)")
    parser.add_argument("--dry-run", action="store_true", help="Tylko podgląd, bez zmian")
    parser.add_argument("--overwrite", action="store_true", help="Nadpisz jeśli dest istnieje")
    parser.add_argument(
        "--run-all",
        action="store_true",
        help="Wykonaj wszystkie merge z MERGE_MAP (w kolejności)",
    )
    parser.add_argument(
        "--delete-source",
        action="store_true",
        help="Usuń folder źródłowy po kopiowaniu (TYLKO po migracji DB!)",
    )
    parser.add_argument(
        "--delete-sources-only",
        action="store_true",
        help="Tylko usuń foldery źródłowe z MERGE_MAP (uruchom PO migracji DB)",
    )
    args = parser.parse_args()

    if args.delete_sources_only:
        s3, bucket = get_s3_client()
        sources = list({p[0] for p in MERGE_MAP})
        for src in sources:
            print(f"Usuwam {src}/...")
            cnt = delete_folder(s3, bucket, src + "/", dry_run=args.dry_run)
            print(f"  Usunięto: {cnt} obiektów")
        return

    if args.run_all:
        pairs = MERGE_MAP
    elif args.source and args.dest:
        pairs = [(args.source, args.dest)]
    else:
        parser.print_help()
        print("\nPrzykład: python merge-r2-folders.py 'emilia szymanska' emiliaszymanska --dry-run")
        sys.exit(1)

    s3, bucket = get_s3_client()
    mode = "[DRY-RUN] " if args.dry_run else ""

    for source, dest in pairs:
        print(f"\n{mode}Merge: {source} -> {dest}")
        copied, skipped, errors = merge_folder(
            s3, bucket, source, dest, dry_run=args.dry_run, overwrite=args.overwrite
        )
        print(f"  Skopiowano: {copied}, pominięto (istnieje): {skipped}, błędów: {errors}")

        if args.delete_source and not args.dry_run and copied > 0:
            print(f"  Usuwam folder źródłowy: {source}/")
            del_count = delete_folder(s3, bucket, source + "/", dry_run=False)
            print(f"  Usunięto obiektów: {del_count}")

    if args.dry_run:
        print("\n(dry-run – uruchom bez --dry-run aby wykonać)")


if __name__ == "__main__":
    main()
