# ContentVault - Startup Guide

Complete guide to get the project running locally from zero.

---

## Prerequisites

Install these before starting:

1. **Node.js 18+** - https://nodejs.org (download LTS)
2. **PostgreSQL** - You have two options:
   - **Option A (Easiest): Neon (free cloud PostgreSQL)** - https://neon.tech
   - **Option B: Local PostgreSQL** - https://www.postgresql.org/download/

3. **Git** - https://git-scm.com/downloads

---

## Step 1: Get your Database URL

### Option A: Neon (recommended, free, no install)

1. Go to https://neon.tech and sign up (GitHub login works)
2. Click **"Create Project"**
3. Name it anything (e.g. "contentvault")
4. Select the closest region to you
5. Click **"Create Project"**
6. You'll see a connection string like:
   ```
   postgresql://username:password@ep-xxx-xxx-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
7. **Copy this entire string** - this is your `DATABASE_URL`

### Option B: Local PostgreSQL

1. Install PostgreSQL from https://www.postgresql.org/download/
2. During install, set a password (remember it!)
3. Open pgAdmin or psql terminal and create a database:
   ```sql
   CREATE DATABASE contentvault;
   ```
4. Your DATABASE_URL will be:
   ```
   postgresql://postgres:YOUR_PASSWORD@localhost:5432/contentvault
   ```

---

## Step 2: Get Discord OAuth Credentials

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** - name it "ContentVault" (or anything)
3. Go to **OAuth2** in the left sidebar
4. Copy the **Client ID** - this is your `AUTH_DISCORD_ID`
5. Click **"Reset Secret"** and copy it - this is your `AUTH_DISCORD_SECRET`
6. Under **Redirects**, add:
   ```
   http://localhost:3000/api/auth/callback/discord
   ```
7. Click **Save Changes**

---

## Step 3: Get Cloudflare R2 Credentials

1. Go to https://dash.cloudflare.com and sign up / log in
2. In the left sidebar, click **R2 Object Storage**
3. If you haven't already, **create a bucket** (or use your existing one)
4. Note the bucket name - this is your `R2_BUCKET_NAME`
5. Your **Account ID** is in the URL: `https://dash.cloudflare.com/ACCOUNT_ID/...`
   - Or find it on the R2 overview page - this is your `R2_ACCOUNT_ID`

### Create R2 API Token:
1. Go to **R2 Overview** > **Manage R2 API Tokens** (or https://dash.cloudflare.com/profile/api-tokens)
2. Click **"Create API token"**
3. Select **"R2 Token"** template (or create custom with R2 read/write)
4. Permissions: **Object Read & Write** for your bucket
5. Click **Create Token**
6. Copy:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
   - **Endpoint** → `R2_ENDPOINT` (format: `https://ACCOUNT_ID.r2.cloudflarestorage.com`)

---

## Step 4: Generate Auth Secret

Run this in your terminal to generate a random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or use: https://generate-secret.vercel.app/32

Copy the output - this is your `AUTH_SECRET`.

---

## Step 5: Email / SMTP (Optional - for notifications)

You can skip this for now. Notifications will still work in-app, just not via email.

If you want email notifications later:

### Free options:
- **Gmail SMTP**: Use your Gmail with an App Password
  - Go to https://myaccount.google.com/apppasswords
  - Generate an app password
  - SMTP_HOST=`smtp.gmail.com`, SMTP_PORT=`587`, SMTP_USER=`your@gmail.com`, SMTP_PASSWORD=`app-password`

- **Resend** (100 emails/day free): https://resend.com
- **Mailgun** (free tier): https://www.mailgun.com

---

## Step 6: Create your .env file

1. In the project root, copy the example:
   ```bash
   cp .env.example .env
   ```
   (On Windows: `copy .env.example .env`)

2. Open `.env` and fill in your values:

```env
# Database (from Step 1)
DATABASE_URL="postgresql://username:password@host/database?sslmode=require"

# Auth Secret (from Step 4)
AUTH_SECRET="your-generated-secret-here"
AUTH_URL="http://localhost:3000"

# Discord OAuth (from Step 2)
AUTH_DISCORD_ID="your-discord-client-id"
AUTH_DISCORD_SECRET="your-discord-client-secret"

# Cloudflare R2 (from Step 3)
R2_ACCOUNT_ID="your-account-id"
R2_ACCESS_KEY_ID="your-access-key-id"
R2_SECRET_ACCESS_KEY="your-secret-access-key"
R2_BUCKET_NAME="your-bucket-name"
R2_ENDPOINT="https://your-account-id.r2.cloudflarestorage.com"

# Email - OPTIONAL, skip for now
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASSWORD=""
SMTP_FROM="noreply@example.com"

# Application
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## Step 7: Set up the database

Run these commands in order:

```bash
# 1. Push the schema to your database (creates all tables)
npx prisma db push

# 2. Seed the database (countries, settings, admin user, credit packages)
npm run db:seed
```

After seeding, you'll have:
- **Admin account**: `admin@contentvault.com` / `admin123`
- 21 countries pre-loaded
- 4 credit packages (Starter, Popular, Pro, Ultimate)
- Default settings (model cost: 50 credits, bundle cost: 500 credits)

---

## Step 8: Run the project

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Step 9: First things to do

### As Admin:
1. Log in with `admin@contentvault.com` / `admin123`
2. Go to `/admin/settings` and set your **crypto wallet addresses** (BTC, ETH, USDT, USDC)
3. Go to `/admin/models` and click **"Import from R2"** to scan your R2 bucket and import all models
4. After import, models will appear. You can edit country assignments per model
5. Adjust credit costs in Settings if needed (default: 50 per model, 500 for bundle)

### As User:
1. Register a new account at `/register`
2. Browse models at `/models`
3. Click any locked model to see the "access required" popup
4. Go to `/purchase` to buy credits
5. After admin approves your credit purchase, credits appear in the header
6. Purchase a model or bundle with credits

---

## Common Issues

### "Can't reach database"
- Double check your DATABASE_URL - no extra spaces, correct password
- If using Neon: make sure `?sslmode=require` is at the end
- If local PostgreSQL: make sure PostgreSQL service is running

### "Discord login not working"
- Make sure the redirect URL is exactly: `http://localhost:3000/api/auth/callback/discord`
- Check that CLIENT_ID and SECRET are correct (no extra spaces)
- Make sure the Discord app is not in "test mode" only

### "R2 import finds nothing"
- Check your R2_BUCKET_NAME matches exactly
- Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are correct
- Make sure your R2 bucket has the expected folder structure:
  ```
  modelname/
    uniqueid_source/
      master.m3u8
      master-720p.m3u8
      ...
    uniqueid_source_thumbnail.webp
  ```

### "Prisma errors"
```bash
# Regenerate the Prisma client
npx prisma generate

# If schema changed, push again
npx prisma db push
```

### "Port 3000 already in use"
```bash
# Run on a different port
npm run dev -- -p 3001
```

---

## Useful Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npx prisma studio` | Open database GUI in browser |
| `npx prisma db push` | Push schema changes to DB |
| `npm run db:seed` | Seed database with initial data |
| `npx prisma generate` | Regenerate Prisma client |

---

## Project Structure (key files)

```
prisma/
  schema.prisma          -- Database schema (all tables)
  seed.ts                -- Database seed script

src/
  app/
    (auth)/login,register  -- Auth pages
    (user)/models,purchase,dashboard,content  -- User pages
    (admin)/admin/*        -- Admin panel pages
    api/                   -- All API routes
  components/
    ui/                    -- Reusable UI components
    admin/                 -- Admin components
    user/                  -- User components
    payments/              -- Credit purchase flow
  lib/
    auth.ts                -- NextAuth configuration
    db.ts                  -- Prisma client
    r2.ts                  -- R2 storage client
    access.ts              -- Access control logic
    utils.ts               -- Utility functions
  messages/
    en.json, pl.json       -- Translations
```

---

## Changing the Admin Password

Log in with the seed password, then update it in the database:

```bash
npx prisma studio
```

This opens a GUI at http://localhost:5555 where you can edit the User table directly.

Or update via the terminal:

```bash
node -e "
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash('YOUR_NEW_PASSWORD', 12);
  await db.user.update({ where: { email: 'admin@contentvault.com' }, data: { password: hash } });
  console.log('Password updated');
  process.exit(0);
})();
"
```
