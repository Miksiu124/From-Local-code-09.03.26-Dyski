#!/bin/bash
# ContentVault - Pełna konfiguracja nowego VPS od zera (Privacy First)
# Uruchom: ssh root@138.249.138.60 'bash -s' < scripts/vps-new-migration-setup.sh
# LUB: scp scripts/vps-new-migration-setup.sh root@138.249.138.60:/tmp/ && ssh root@138.249.138.60 'bash /tmp/vps-new-migration-setup.sh'

set -e

echo "=========================================="
echo "ContentVault - VPS Migration Setup"
echo "=========================================="

# 1. Utworzenie użytkownika deploy
echo "[1/6] Tworzę użytkownika deploy..."
if ! id deploy &>/dev/null; then
  adduser --disabled-password --gecos "" deploy
  echo "deploy:DeploySecure2025!" | chpasswd
  usermod -aG sudo deploy
  echo "   Użytkownik deploy utworzony. Hasło: DeploySecure2025! (zmień po pierwszym logowaniu)"
else
  echo "   Użytkownik deploy już istnieje"
fi

# 2. Instalacja zależności
echo "[2/6] Aktualizuję system i instaluję pakiety..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw fail2ban iptables-persistent netfilter-persistent

# 3. Docker
echo "[3/6] Instaluję Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi
usermod -aG docker deploy 2>/dev/null || true

# 4. Katalog aplikacji
echo "[4/6] Tworzę katalog /opt/contentvault..."
mkdir -p /opt/contentvault
chown deploy:deploy /opt/contentvault

# 5. Firewall Cloudflare-only (PRZED aktualizacją DNS)
echo "[5/6] Konfiguruję firewall Cloudflare-only na 80/443..."
CF_IPS=(
  "173.245.48.0/20" "103.21.244.0/22" "103.22.200.0/22" "103.31.4.0/22"
  "141.101.64.0/18" "108.162.192.0/18" "190.93.240.0/20" "188.114.96.0/20"
  "197.234.240.0/22" "198.41.128.0/17" "162.158.0.0/15" "104.16.0.0/13"
  "104.24.0.0/14" "172.64.0.0/13" "131.0.72.0/22"
)
iptables -N CF-ALLOW 2>/dev/null || iptables -F CF-ALLOW
for ip in "${CF_IPS[@]}"; do
  iptables -A CF-ALLOW -p tcp -s "$ip" -m multiport --dports 80,443 -j ACCEPT
done
iptables -D INPUT -p tcp -m multiport --dports 80,443 -j CF-ALLOW 2>/dev/null || true
iptables -D INPUT -p tcp -m multiport --dports 80,443 -j DROP 2>/dev/null || true
iptables -I INPUT -p tcp -m multiport --dports 80,443 -j CF-ALLOW
iptables -A INPUT -p tcp -m multiport --dports 80,443 -j DROP

# Zapisz reguły iptables
mkdir -p /etc/iptables
iptables-save > /etc/iptables/rules.v4
apt-get install -y -qq iptables-persistent 2>/dev/null || true
netfilter-persistent save 2>/dev/null || true

# UFW - tylko SSH
echo "[6/6] Konfiguruję UFW (SSH)..."
ufw allow 22/tcp
ufw --force enable

echo ""
echo "=========================================="
echo "GOTOWE. VPS skonfigurowany."
echo "=========================================="
echo "Następne kroki:"
echo "1. Skopiuj klucz SSH do deploy: rsync -avz ~/.ssh root@138.249.138.60:/home/deploy/ && ssh root@138.249.138.60 'chown -R deploy:deploy /home/deploy/.ssh'"
echo "2. Zaktualizuj Cloudflare DNS: A record dyskiof.net -> 138.249.138.60 (Proxied ON)"
echo "3. Deploy: ./scripts/deploy-vps.sh --build"
echo ""
