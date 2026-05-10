#!/usr/bin/env bash
# Run ON the VPS (as the same user SSH / CD uses) once: create read-only SSH key for github.com fetch.
# Afterward add the printed public key under GitHub: Repository → Settings → Deploy keys → read-only.
#
# Usage from dev machine:
#   scp scripts/vps-ensure-github-readonly-key.sh user@host:/tmp/
#   ssh user@host bash /tmp/vps-ensure-github-readonly-key.sh

set -euo pipefail
mkdir -p ~/.ssh
chmod 700 ~/.ssh
KEY="${HOME}/.ssh/id_ed25519_github_content"
if [[ ! -f "$KEY" ]]; then
	ssh-keygen -t ed25519 -f "$KEY" -N '' -C "contentvault-vps-readonly-deploy"
fi
CFG="${HOME}/.ssh/config"
if ! grep -qE '^Host github\.com\s*$' "$CFG" 2>/dev/null; then
	printf '\n%s\n' "Host github.com
  IdentityFile ${KEY}
  IdentitiesOnly yes" >>"$CFG"
fi
chmod 600 "$CFG"
echo "===== Add Deploy key on GitHub (read-only): https://github.com/<org>/<repo>/settings/keys ====="
cat "${KEY}.pub"
