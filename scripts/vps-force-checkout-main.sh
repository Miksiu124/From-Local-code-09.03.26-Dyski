#!/usr/bin/env bash
# DANGER: One-time migration from tar/scp tree to a clean git checkout on the VPS.
# Removes untracked copies of repo files (git clean) while keeping .env*, uploads, nginx/certs.
# Run only after backup. Prefer from dev machine: scp + ssh bash (see scripts/bootstrap-vps-cd.sh).
set -euo pipefail
cd /opt/contentvault
mkdir -p /root/contentvault-cd-backup
cp -a .env /root/contentvault-cd-backup/.env.save 2>/dev/null || true
cp -a .env.vps /root/contentvault-cd-backup/.env.vps.save 2>/dev/null || true
cp -a .env.lgtm /root/contentvault-cd-backup/.env.lgtm.save 2>/dev/null || true
export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"
git fetch origin main || true
git clean -fd -e .env -e .env.local -e .env.vps -e .env.lgtm -e uploads -e nginx/certs
git checkout -f -B main origin/main
chmod +x scripts/rollout-on-vps.sh scripts/compose-vps-files.sh 2>/dev/null || true
test -f scripts/rollout-on-vps.sh && echo ROLLOUT_OK
git status -sb | head -8
