# 🚀 VPS Deployment Guide — Content Platform

> **Last updated:** 2026-02-22  
> **Stack:** Next.js 15 · Go 1.24 · PostgreSQL 16 · Redis 7 · Nginx · Docker Compose  
> **Estimated deployment time:** 30–60 minutes

---

## Table of Contents

1. [Hardware Recommendations](#1-hardware-recommendations)
2. [Pre-Deployment Checklist](#2-pre-deployment-checklist)
3. [VPS Setup (OS & Dependencies)](#3-vps-setup)
4. [SSL Certificate Setup](#4-ssl-certificate-setup)
5. [Clone & Configure the App](#5-clone--configure-the-app)
6. [Configure Nginx for Your Domain](#6-configure-nginx-for-your-domain)
7. [Launch the Stack](#7-launch-the-stack)
8. [Post-Deployment Verification](#8-post-deployment-verification)
9. [Backups](#9-backups)
10. [Monitoring & Alerting](#10-monitoring--alerting)
11. [Updating the Application](#11-updating-the-application)
12. [Security Hardening Checklist](#12-security-hardening-checklist)

---

## 1. Hardware Recommendations

### Minimum (development/staging, light traffic, <100 users)

| Component | Recommendation |
|-----------|----------------|
| **CPU** | 2 vCPUs |
| **RAM** | 4 GB |
| **Storage** | 40 GB SSD |
| **Bandwidth** | 1 TB/month |
| **OS** | Ubuntu 24.04 LTS |

### Recommended (production, medium traffic, <1000 concurrent users)

| Component | Recommendation |
|-----------|----------------|
| **CPU** | 4 vCPUs |
| **RAM** | 8 GB |
| **Storage** | 80 GB NVMe SSD |
| **Bandwidth** | 5 TB/month |
| **OS** | Ubuntu 24.04 LTS |

> **Note on storage:** Your video content is served from **Cloudflare R2**, not from the VPS. The VPS only needs space for the Docker images (~2 GB), PostgreSQL data, Redis data, and logs.

### Recommended VPS Providers

| Provider | Tier | Approx. Price | Notes |
|----------|------|---------------|-------|
| **Hetzner Cloud** | CX22 (2 vCPU, 4 GB) | ~€4/mo | ⭐ Best value in EU. German/Finnish data centers. |
| **Hetzner Cloud** | CX32 (4 vCPU, 8 GB) | ~€8/mo | ⭐ Recommended production tier. |
| **DigitalOcean** | Basic 4 GB Droplet | ~$24/mo | Good documentation, higher price. |
| **Vultr** | Regular 4 GB | ~$20/mo | Good EU locations. |
| **OVHcloud** | VPS Starter | ~€5/mo | Budget option, French data center. |

> 💡 **Recommendation:** Use **Hetzner Cloud CX32** (4 vCPU, 8 GB RAM, 80 GB NVMe) for production. It offers outstanding performance-per-euro and is ideal for EU-hosted platforms.

---

## 2. Pre-Deployment Checklist

### ⚠️ Critical: Rotate All Secrets Before Going Live

The current `.env` contains development credentials that must **never** be used in production:

- [ ] Generate a new **JWT_SECRET** (64+ random chars): `openssl rand -hex 64`
- [ ] Generate a new **STREAMING_TOKEN_SECRET** (64+ random chars): `openssl rand -hex 64`
- [ ] Generate a strong **POSTGRES_PASSWORD**: `openssl rand -base64 32`
- [ ] Rotate your **Cloudflare R2 API keys** in the Cloudflare dashboard
- [ ] Update **ADMIN_EMAILS** to your real admin email(s)

### DNS
- [ ] Point your domain's **A record** → VPS IP address
- [ ] Add `www` **CNAME** → your root domain (optional but recommended)
- [ ] Wait for DNS propagation (can take up to 48h; use https://dnschecker.org)

### Cloudflare (if using CF as proxy)
If your domain is proxied through Cloudflare (orange cloud):
- [ ] Set SSL/TLS mode to **Full (strict)** in CF dashboard
- [ ] Disable "Always Use HTTPS" in CF (nginx handles this)
- [ ] Optionally enable Cloudflare's DDoS protection rules

---

## 3. VPS Setup

### 3.1 Initial Server Setup

```bash
# Log in as root
ssh root@YOUR_VPS_IP

# Create a non-root user
adduser deploy
usermod -aG sudo deploy

# Copy your SSH key
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Log out and log back in as deploy
exit
ssh deploy@YOUR_VPS_IP
```

### 3.2 Install Docker & Docker Compose

```bash
# Update packages
sudo apt-get update && sudo apt-get upgrade -y

# Install prerequisites
sudo apt-get install -y ca-certificates curl gnupg ufw fail2ban git

# Install Docker
curl -fsSL https://get.docker.com | sudo bash

# Add deploy user to docker group (log out/in after this)
sudo usermod -aG docker deploy

# Verify Docker is working
docker --version
docker compose version
```

### 3.3 Firewall Setup

```bash
# Allow SSH, HTTP, HTTPS only
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Verify
sudo ufw status
```

### 3.4 Fail2ban (Brute Force Protection)

```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check it's running
sudo fail2ban-client status
```

---

## 4. SSL Certificate Setup

### 4.1 Install Certbot (standalone — before Docker is running)

```bash
sudo apt-get install -y certbot

# Stop anything on port 80 temporarily (if needed)
# Issue the certificate
sudo certbot certonly --standalone \
  --non-interactive \
  --agree-tos \
  --email your-email@example.com \
  -d yourdomain.com \
  -d www.yourdomain.com
```

Certificates are stored at:
- `/etc/letsencrypt/live/yourdomain.com/fullchain.pem`
- `/etc/letsencrypt/live/yourdomain.com/privkey.pem`

### 4.2 Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot auto-renewal is already set up via systemd timer
# Verify:
sudo systemctl status certbot.timer
```

> **⚠️ Important:** The Nginx container mounts `/etc/letsencrypt` as read-only. After certificate renewal, you must restart Nginx:
> ```bash
> docker compose restart nginx
> ```
> Add this to a cron job to automate it:
> ```bash
> # Edit crontab
> sudo crontab -e
> # Add this line (restarts nginx after certbot renewal, twice daily):
> 0 0,12 * * * certbot renew --quiet && docker compose -f /opt/platform/docker-compose.yml restart nginx
> ```

---

## 5. Clone & Configure the App

### 5.1 Clone the Repository

```bash
# Create app directory
sudo mkdir -p /opt/platform
sudo chown deploy:deploy /opt/platform

# Clone your repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /opt/platform
cd /opt/platform
```

### 5.2 Create the Production `.env` File

```bash
# Create the .env file (NEVER commit this file)
nano /opt/platform/.env
```

Paste and fill in the following — replace every `CHANGE_ME` value:

```env
# ── Server ────────────────────────────────────────────────────
ENVIRONMENT=production
PORT=8080
FRONTEND_URL=https://yourdomain.com

# ── Database ──────────────────────────────────────────────────
POSTGRES_PASSWORD=CHANGE_ME_strong_random_password
DATABASE_URL=postgresql://platform:CHANGE_ME_strong_random_password@postgres:5432/content_platform?sslmode=disable

# ── Redis ─────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── JWT & Sessions ────────────────────────────────────────────
JWT_SECRET=CHANGE_ME_64_random_chars_minimum
JWT_EXPIRY_SECS=2592000
SESSION_TOKEN_TTL=2592000

# ── Cloudflare R2 ─────────────────────────────────────────────
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=files
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# ── HLS Streaming ─────────────────────────────────────────────
STREAMING_TOKEN_SECRET=CHANGE_ME_64_random_chars_minimum
STREAMING_TOKEN_TTL=21600

# ── Admin ─────────────────────────────────────────────────────
ADMIN_EMAILS=your-admin@email.com

# ── BLIK ──────────────────────────────────────────────────────
BLIK_EXPIRATION_MINUTES=2

# ── SMTP (BillionMail) ───────────────────────────────────────
# Self-hosted Postfix relay — no external provider needed
SMTP_HOST=billionmail-postfix
SMTP_PORT=25
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@yourdomain.com
BILLIONMAIL_HOSTNAME=mail.yourdomain.com

# ── Frontend ──────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

**Generate secret values:**

```bash
# Generate JWT_SECRET
openssl rand -hex 64

# Generate STREAMING_TOKEN_SECRET
openssl rand -hex 64

# Generate POSTGRES_PASSWORD
openssl rand -base64 32
```

### 5.3 Secure the `.env` File

```bash
chmod 600 /opt/platform/.env
```

---

## 6. Configure Nginx for Your Domain

Edit the nginx config and replace `yourdomain.com` with your actual domain:

```bash
sed -i 's/yourdomain.com/YOUR_ACTUAL_DOMAIN/g' /opt/platform/nginx/nginx.conf
```

**Verify the changes:**

```bash
grep "server_name\|ssl_certificate" /opt/platform/nginx/nginx.conf
```

---

## 7. Launch the Stack

### 7.1 Build and Start All Services

```bash
cd /opt/platform

# Build all images
docker compose build --no-cache

# Start in detached mode
docker compose up -d

# Watch the logs (Ctrl+C to exit)
docker compose logs -f
```

### 7.2 Run Database Seed (first time only)

```bash
# Seed the database with initial data (countries, settings, admin user, credit packages)
docker compose exec api ./server -seed

# OR if using the dedicated seed binary:
docker compose exec api sh -c "cd /app && ./seed"
```

> **Note:** The Go backend automatically runs database migrations on startup. You only need to run the seed once.

### 7.3 Verify Services Are Healthy

```bash
docker compose ps
```

All services should show `healthy` or `running`:

```
NAME                          STATUS              PORTS
content-nginx                 running             0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
content-frontend              healthy             0.0.0.0:3000->3000/tcp
content-api                   healthy             0.0.0.0:8080->8080/tcp
content-postgres              healthy             127.0.0.1:5432->5432/tcp
content-redis                 healthy             127.0.0.1:6379->6379/tcp
content-billionmail-postfix   healthy             127.0.0.1:25->25/tcp, 127.0.0.1:587->587/tcp
```

---

## 8. Post-Deployment Verification

Run these checks after startup:

```bash
# 1. Health check
curl -s https://yourdomain.com/health
# Expected: {"status":"ok"}

# 2. Check HTTPS redirect (should return 301)
curl -I http://yourdomain.com
# Expected: HTTP/1.1 301 Moved Permanently
# Location: https://yourdomain.com/

# 3. Check HSTS header is present
curl -Is https://yourdomain.com | grep -i strict-transport
# Expected: strict-transport-security: max-age=31536000; includeSubDomains; preload

# 4. Check API is accessible
curl -s https://yourdomain.com/api/settings/public

# 5. Check frontend loads
curl -s -o /dev/null -w "%{http_code}" https://yourdomain.com
# Expected: 200

# 6. SSL Grade check (do this in browser):
# https://www.ssllabs.com/ssltest/analyze.html?d=yourdomain.com
# Target: A or A+
```

---

## 9. Backups

### 9.1 Database Backup Script

```bash
cat > /opt/platform/scripts/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/backups"
mkdir -p "$BACKUP_DIR"

# Dump PostgreSQL
docker compose -f /opt/platform/docker-compose.yml exec -T postgres \
  pg_dump -U platform content_platform | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# Keep only last 30 days
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +30 -delete

echo "Backup complete: db_$DATE.sql.gz"
EOF

chmod +x /opt/platform/scripts/backup.sh
```

### 9.2 Schedule Daily Backups

```bash
# Add to crontab
crontab -e
# Add:
0 3 * * * /opt/platform/scripts/backup.sh >> /var/log/platform-backup.log 2>&1
```

### 9.3 Restore from Backup

```bash
# Restore a specific backup
gunzip -c /opt/backups/db_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose -f /opt/platform/docker-compose.yml exec -T postgres \
  psql -U platform content_platform
```

> **⚠️ Important:** Also back up your `.env` file to a **secure, encrypted** location (e.g., password manager or encrypted cloud storage). Without it, you cannot decrypt your JWT sessions.

---

## 10. Monitoring & Alerting

### 10.1 View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f nginx

# Last 100 lines
docker compose logs --tail=100 api
```

### 10.2 Resource Usage

```bash
# Live container stats (CPU, RAM, network)
docker stats
```

### 10.3 Simple Uptime Monitoring (Free)

Sign up for a free account at https://uptimerobot.com and add a monitor for:
- `https://yourdomain.com/health` — API health
- `https://yourdomain.com` — Frontend

Set up email/Telegram alerts for downtime.

### 10.4 Log Rotation

Docker logs are automatically rotated. To limit log size, add to `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

Then reload: `sudo systemctl restart docker`

---

## 11. Updating the Application

```bash
cd /opt/platform

# Pull latest code
git pull origin main

# Rebuild and restart without downtime
docker compose build --no-cache api frontend
docker compose up -d --no-deps api frontend

# Verify health
docker compose ps
docker compose logs --tail=50 api
```

---

## 12. Security Hardening Checklist

### Must Do Before Going Live

- [ ] All secrets rotated (JWT, streaming token, DB password, R2 keys)
- [ ] `.env` file has `chmod 600` permissions
- [ ] `ENVIRONMENT=production` set in `.env`
- [ ] `FRONTEND_URL` and `NEXT_PUBLIC_APP_URL` set to your HTTPS domain
- [ ] UFW firewall enabled (only ports 22, 80, 443 open)
- [ ] Fail2ban running
- [ ] SSL certificate issued and auto-renewal configured
- [ ] Nginx HTTPS config updated with your domain name
- [ ] All API secrets are 64+ random character strings
- [ ] `BILLIONMAIL_HOSTNAME` set to your mail subdomain (e.g. `mail.yourdomain.com`)
- [ ] DNS records configured for BillionMail: MX, SPF, DKIM, DMARC

### Recommended Additions (Post-Launch)

- [ ] **Redis authentication:** Add `requirepass STRONG_PASSWORD` to Redis command in `docker-compose.yml`, and update `REDIS_URL=redis://:STRONG_PASSWORD@redis:6379`
- [ ] **Database SSL:** Once on VPS, change `?sslmode=disable` to `?sslmode=require` in `DATABASE_URL`
- [ ] **SSH Key Auth Only:** Disable password SSH login: `PasswordAuthentication no` in `/etc/ssh/sshd_config`
- [ ] **Automatic OS Updates:** `sudo apt-get install unattended-upgrades && sudo dpkg-reconfigure --priority=low unattended-upgrades`
- [ ] **Container image scanning:** Run `docker scout quickview` periodically
- [ ] **CI/CD pipeline:** Add GitHub Actions to run `go test ./...` on every push

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `nginx` fails to start | Check cert path: `ls /etc/letsencrypt/live/yourdomain.com/` |
| `api` fails with DB error | Check `POSTGRES_PASSWORD` matches in `.env` and Docker service |
| Frontend shows blank page | Check `NEXT_PUBLIC_APP_URL` is set to your HTTPS domain |
| Redis connection errors | Verify `REDIS_URL` doesn't have a password if Redis has none |
| 502 Bad Gateway | Check if `api` or `frontend` containers are healthy: `docker compose ps` |
| BLIK WebSocket fails | Ensure nginx WebSocket config is correct; check `FRONTEND_URL` env var |
| Emails not sending | Check BillionMail Postfix is healthy: `docker compose logs billionmail-postfix` |
| Emails going to spam | Verify MX, SPF, DKIM, DMARC DNS records for `BILLIONMAIL_HOSTNAME` |

---

*Generated by Antigravity AI · 2026-02-22*
