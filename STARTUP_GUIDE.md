# ContentVault — Production Deployment Guide

Complete guide for deploying ContentVault on a VPS with maximum security and owner anonymity.

---

## Table of Contents

1. [VPS Setup](#1-vps-setup)
2. [Domain & Cloudflare](#2-domain--cloudflare)
3. [SSL Certificates](#3-ssl-certificates)
4. [Secret Generation](#4-secret-generation)
5. [Environment Configuration](#5-environment-configuration)
6. [Database Migrations](#6-database-migrations)
7. [First Deploy](#7-first-deploy)
8. [Post-Deploy Verification](#8-post-deploy-verification)
9. [Maintenance & Backups](#9-maintenance--backups)
10. [Owner Anonymity Best Practices](#10-owner-anonymity-best-practices)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. VPS Setup

### Recommended Specs

- **OS:** Ubuntu 22.04 or 24.04 LTS
- **RAM:** 2 GB minimum, 4 GB recommended
- **CPU:** 2 vCPUs
- **Storage:** 40 GB SSD minimum
- **Provider:** Choose a privacy-friendly provider that accepts crypto (e.g., Njalla, 1984hosting, BuyVM, Privex)

### Initial Server Setup

```bash
# Connect via SSH
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Create non-root user
adduser deploy
usermod -aG sudo deploy

# Setup SSH key auth (from your LOCAL machine)
# ssh-copy-id deploy@YOUR_VPS_IP

# Disable password auth (after confirming key auth works)
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Setup firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy

# Install Docker Compose (v2 comes with Docker now)
docker compose version

# Logout and login as deploy user
exit
```

### Harden SSH

```bash
# Change SSH port (optional but recommended)
sudo nano /etc/ssh/sshd_config
# Change: Port 2222 (or another non-standard port)
# Then: sudo ufw allow 2222/tcp && sudo ufw delete allow ssh
sudo systemctl restart sshd
```

### Install fail2ban

```bash
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## 2. Domain & Cloudflare

### Domain Registration

1. Register domain through a privacy-respecting registrar (Njalla, Namecheap with WhoisGuard)
2. Use WHOIS privacy protection
3. Do NOT use personal information in registration

### Cloudflare Setup

1. Create Cloudflare account (use a dedicated email, not personal)
2. Add your domain to Cloudflare
3. Update nameservers at your registrar to Cloudflare's

### Cloudflare Configuration

```
SSL/TLS → Overview → Full (strict)
SSL/TLS → Edge Certificates → Always Use HTTPS: ON
SSL/TLS → Edge Certificates → Minimum TLS Version: 1.2
SSL/TLS → Edge Certificates → Automatic HTTPS Rewrites: ON

SSL/TLS → Origin Server → Authenticated Origin Pulls: ON
(Download the Cloudflare Origin CA certificate for nginx)

Security → Settings → Security Level: Medium
Security → Settings → Challenge Passage: 30 minutes
Security → Settings → Browser Integrity Check: ON

Speed → Optimization → Auto Minify: CSS, JS
Caching → Configuration → Browser Cache TTL: 4 hours

Network → WebSockets: ON (required for BLIK)
Network → HTTP/2: ON
Network → HTTP/3: ON
```

### DNS Records

```
Type  Name   Content         Proxy
A     @      YOUR_VPS_IP     Proxied (orange cloud)
CNAME www    yourdomain.com  Proxied (orange cloud)
```

### Download Cloudflare Origin Pull Certificate

```bash
# On your VPS:
sudo mkdir -p /opt/contentvault/nginx/certs/security
curl -o /opt/contentvault/nginx/certs/security/cloudflare-origin.crt \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
```

---

## 3. SSL Certificates

### Option A: Cloudflare Origin Certificate (Recommended)

1. Go to Cloudflare → SSL/TLS → Origin Server
2. Click "Create Certificate"
3. Let Cloudflare generate a private key
4. Certificate validity: 15 years
5. Save the certificate and key

```bash
# On your VPS:
sudo mkdir -p /opt/contentvault/nginx/certs

# Paste the certificate
sudo nano /opt/contentvault/nginx/certs/fullchain.pem

# Paste the private key
sudo nano /opt/contentvault/nginx/certs/privkey.pem

# Set permissions
sudo chmod 600 /opt/contentvault/nginx/certs/privkey.pem
sudo chmod 644 /opt/contentvault/nginx/certs/fullchain.pem
```

### Option B: Let's Encrypt (if not using Cloudflare proxy)

```bash
sudo apt install certbot -y
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
# Certs will be at /etc/letsencrypt/live/yourdomain.com/
```

---

## 4. Secret Generation

Run these commands to generate all required secrets:

```bash
# JWT Secret (64 hex chars)
echo "JWT_SECRET=$(openssl rand -hex 32)"

# Auth Secret
echo "AUTH_SECRET=$(openssl rand -hex 32)"

# Streaming Token Secret
echo "STREAMING_TOKEN_SECRET=$(openssl rand -hex 32)"

# PostgreSQL Password
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)"
```

Save these values — you'll need them for the `.env` file.

---

## 5. Environment Configuration

```bash
# On your VPS:
cd /opt/contentvault

# Copy the production template
cp .env.production.example .env

# Edit with your values
nano .env
```

### Required Changes

Replace ALL placeholder values:

1. `FRONTEND_URL` → `https://yourdomain.com`
2. `POSTGRES_PASSWORD` → generated password
3. `DATABASE_URL` → update the password in the connection string
4. `JWT_SECRET` → generated secret
5. `AUTH_SECRET` → generated secret
6. `AUTH_URL` → `https://yourdomain.com`
7. `STREAMING_TOKEN_SECRET` → generated secret
8. `R2_*` → your Cloudflare R2 credentials
9. `ADMIN_EMAILS` → your admin email(s)
10. `SMTP_*` → your email provider credentials
11. `NEXT_PUBLIC_APP_URL` → `https://yourdomain.com`

### Update nginx.conf.production

```bash
# Replace domain name in nginx config
sed -i 's/dyskiofleaks.com/yourdomain.com/g' nginx/nginx.conf.production
```

---

## 6. Database Migrations

Migrations run automatically on first PostgreSQL start via the `docker-entrypoint-initdb.d` mount.

The migration files in `backend/migrations/` are mounted into the PostgreSQL container and executed in alphabetical order on first boot.

### Manual Migration (if needed)

```bash
# Connect to running postgres container
docker exec -it content-postgres psql -U platform -d content_platform

# Run a specific migration manually
\i /docker-entrypoint-initdb.d/001_initial_schema.up.sql
```

### Seed Initial Data

After the database is up:

```bash
# Run the seed script (creates admin user, packages, countries, settings)
docker exec -it content-api /app/seed
```

Or seed from the frontend:

```bash
docker exec -it content-frontend npx tsx prisma/seed.ts
```

---

## 7. First Deploy

### Upload Code to VPS

```bash
# From your LOCAL machine:
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  ./ContentManager/ deploy@YOUR_VPS_IP:/opt/contentvault/

# Or use git:
# ssh deploy@YOUR_VPS_IP
# cd /opt && git clone YOUR_REPO contentvault
```

### Build and Start

```bash
ssh deploy@YOUR_VPS_IP
cd /opt/contentvault

# Build all containers
docker compose -f docker-compose.yml -f docker-compose.production.yml build

# Start in detached mode
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d

# Watch logs
docker compose logs -f

# Check all services are healthy
docker compose ps
```

### Verify Services

```bash
# Check API health
curl http://localhost:8080/health

# Check frontend
curl -I http://localhost:3000

# Check nginx (from outside or via Cloudflare)
curl -I https://yourdomain.com
```

---

## 8. Post-Deploy Verification

### Security Checklist

```bash
# Verify SSL grade
# Visit: https://www.ssllabs.com/ssltest/analyze.html?d=yourdomain.com

# Verify security headers
# Visit: https://securityheaders.com/?q=yourdomain.com

# Verify no direct IP access works
curl -k https://YOUR_VPS_IP  # Should return 444 / connection reset

# Verify PostgreSQL is not accessible externally
nmap -p 5432 YOUR_VPS_IP  # Should show filtered/closed

# Verify Redis is not accessible externally
nmap -p 6379 YOUR_VPS_IP  # Should show filtered/closed
```

### Functional Checklist

- [ ] Homepage loads
- [ ] Registration works
- [ ] Login works
- [ ] Admin panel accessible (login with admin email)
- [ ] Models display with thumbnails
- [ ] Video streaming works (HLS)
- [ ] Credit purchase flow works
- [ ] BLIK WebSocket connects
- [ ] Discord webhooks fire
- [ ] Password reset emails send
- [ ] Rate limiting works (try rapid requests)

---

## 9. Maintenance & Backups

### Database Backups

```bash
# Create backup script
cat > /opt/contentvault/backup.sh << 'SCRIPT'
#!/bin/bash
BACKUP_DIR="/opt/backups/postgres"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker exec content-postgres pg_dump -U platform content_platform | gzip > "$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"
# Keep only last 30 backups
ls -t "$BACKUP_DIR"/backup_*.sql.gz | tail -n +31 | xargs -r rm
echo "Backup completed: backup_$TIMESTAMP.sql.gz"
SCRIPT
chmod +x /opt/contentvault/backup.sh

# Add to crontab (daily at 3 AM)
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/contentvault/backup.sh") | crontab -
```

### Restore from Backup

```bash
gunzip < /opt/backups/postgres/backup_TIMESTAMP.sql.gz | \
  docker exec -i content-postgres psql -U platform content_platform
```

### Update Deployment

```bash
cd /opt/contentvault

# Pull latest code
git pull  # or rsync from local

# Rebuild and restart
docker compose -f docker-compose.yml -f docker-compose.production.yml build
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d

# Check logs for errors
docker compose logs --tail=50
```

### Monitor Disk Space

```bash
# Check Docker disk usage
docker system df

# Clean unused images/containers
docker system prune -f
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f nginx

# Last 100 lines
docker compose logs --tail=100 api
```

---

## 10. Owner Anonymity Best Practices

### Domain & Hosting

- Register domain through Njalla (they own the domain on your behalf) or use WHOIS privacy
- Pay for VPS with cryptocurrency (Monero preferred)
- Use a dedicated email (ProtonMail or Tutanota) for all service registrations
- Never link personal accounts to the platform infrastructure

### Cloudflare

- Cloudflare hides your server IP — NEVER expose it
- The nginx config rejects direct IP connections (`ssl_reject_handshake on`)
- Enable "Under Attack" mode if you suspect scanning

### Server Security

- SSH only via key authentication (password auth disabled)
- Change SSH port from 22 to something non-standard
- Use fail2ban to block brute force attempts
- Keep the firewall tight (only 80, 443, and your SSH port)

### Network Hygiene

- Never SSH from your home IP without a VPN
- Use Tor or a trusted VPN when managing the server
- Consider using a jump box / bastion host

### Email

- Use a dedicated email for SMTP that is not linked to your identity
- Consider using a transactional email service (Resend, Postmark) with crypto payment

### DNS Leak Prevention

- All DNS should go through Cloudflare (proxied, orange cloud)
- Never create DNS records that point directly to your IP without proxy
- Check for DNS leaks: `dig +short yourdomain.com` should show Cloudflare IPs, not yours

### Operational Security

- Do not mention the server IP in any public channel
- Do not store server credentials in cloud services linked to your identity
- Use a password manager (Bitwarden, KeePassXC) for all credentials
- Rotate secrets periodically (JWT, streaming tokens)

### What the nginx config does for you

- Default server block returns 444 (connection reset) for any request by IP
- `ssl_reject_handshake on` prevents SSL certificate leaking your domain
- Cloudflare Authenticated Origin Pulls ensure only Cloudflare can reach your server
- `server_tokens off` hides nginx version
- Security headers prevent clickjacking, XSS, content sniffing

---

## 11. Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs api
docker compose logs frontend

# Check if ports are in use
sudo lsof -i :8080
sudo lsof -i :3000
```

### Database connection refused

```bash
# Check postgres is running
docker compose ps postgres

# Check postgres logs
docker compose logs postgres

# Verify DATABASE_URL in .env matches docker-compose service name
# It should use 'postgres' as hostname (the service name), not 'localhost'
```

### Frontend can't reach API

```bash
# Inside Docker, the API is at http://api:8080
# Check the API_URL env var in docker-compose.yml
# It should be: API_URL=http://api:8080/api

# Test from frontend container
docker exec content-frontend wget -qO- http://api:8080/health
```

### SSL certificate errors

```bash
# Check cert files exist and are readable
ls -la /opt/contentvault/nginx/certs/

# Verify cert matches domain
openssl x509 -in nginx/certs/fullchain.pem -text -noout | grep "Subject:"

# Check nginx config syntax
docker exec content-nginx nginx -t
```

### Migrations didn't run

```bash
# Check if tables exist
docker exec -it content-postgres psql -U platform -d content_platform -c "\dt"

# Run migrations manually
docker exec -it content-postgres psql -U platform -d content_platform \
  -f /docker-entrypoint-initdb.d/001_initial_schema.up.sql
```

### Redis connection issues

```bash
# Test Redis
docker exec content-redis redis-cli ping
# Should return: PONG
```

### High memory usage

```bash
# Check container resource usage
docker stats

# If postgres is using too much memory, adjust shared_buffers
# in docker-compose.production.yml
```
