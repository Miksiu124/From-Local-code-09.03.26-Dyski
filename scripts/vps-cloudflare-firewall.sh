#!/bin/bash
# Cloudflare-only firewall for ports 80, 443
# Cel: Blokada dostępu do origin z zewnątrz - tylko Cloudflare może łączyć się na 80/443
# Efekt: Censys/Shodan nie dostaną odpowiedzi → brak powiązania IP↔domena
#
# Uruchom na VPS: sudo ./vps-cloudflare-firewall.sh
# Wymaga: iptables (lub ufw - patrz alternatywa poniżej)

set -e

# Cloudflare IPv4 (https://www.cloudflare.com/ips-v4)
CF_IPS=(
  "173.245.48.0/20"
  "103.21.244.0/22"
  "103.22.200.0/22"
  "103.31.4.0/22"
  "141.101.64.0/18"
  "108.162.192.0/18"
  "190.93.240.0/20"
  "188.114.96.0/20"
  "197.234.240.0/22"
  "198.41.128.0/17"
  "162.158.0.0/15"
  "104.16.0.0/13"
  "104.24.0.0/14"
  "172.64.0.0/13"
  "131.0.72.0/22"
)

# Porty do ochrony
PORTS="80 443"

echo "=== Cloudflare-only firewall (80, 443) ==="
echo "Uwaga: SSH (22) pozostaje otwarty. Ogranicz go osobno jeśli potrzeba."
echo ""

# Flush istniejących reguł dla INPUT (ostrożnie - może zerwać SSH!)
# Lepsze: dodaj reguły, nie flushuj. Użyj osobnego chaina.

# Twórz chain CF-ALLOW jeśli nie istnieje
iptables -N CF-ALLOW 2>/dev/null || iptables -F CF-ALLOW

# Zezwól Cloudflare
for ip in "${CF_IPS[@]}"; do
  iptables -A CF-ALLOW -p tcp -s "$ip" -m multiport --dports $PORTS -j ACCEPT
done

# W INPUT: najpierw sprawdź CF-ALLOW, potem DROP na 80/443
# Usuń stare reguły CF jeśli były (idempotent)
iptables -D INPUT -p tcp -m multiport --dports $PORTS -j CF-ALLOW 2>/dev/null || true
iptables -D INPUT -p tcp -m multiport --dports $PORTS -j DROP 2>/dev/null || true

iptables -I INPUT -p tcp -m multiport --dports $PORTS -j CF-ALLOW
iptables -A INPUT -p tcp -m multiport --dports $PORTS -j DROP

echo "Reguły dodane. Test: curl -I http://$(curl -s ifconfig.me)/ (z zewnątrz) powinien timeout."
echo ""
echo "Zapisz reguły: iptables-save | sudo tee /etc/iptables.rules"
echo "Przy starcie: iptables-restore < /etc/iptables.rules"
