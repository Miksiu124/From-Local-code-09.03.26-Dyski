# API Routes — Go Backend

> Wszystkie endpointy zdefiniowane w `backend/cmd/server/main.go`
> Base path: `/api`

## 🔓 Public (bez auth)

| Method | Path | Handler | Opis |
|---|---|---|---|
| POST | `/auth/register` | `auth.Register` | Rejestracja |
| POST | `/auth/login` | `auth.Login` | Login |
| POST | `/auth/logout` | `auth.Logout` | Logout |
| GET | `/models` | `models.List` | Lista modeli (cursor pagination) |
| GET | `/models/stats` | `models.GetStats` | Statystyki (totalModels) |
| GET | `/models/:slug` | `models.GetBySlug` | Szczegóły modelu |
| GET | `/models/:slug/content` | `models.ListContent` | Content items modelu |
| GET | `/models/:slug/avatar` | `content.ModelAvatar` | Avatar modelu (R2 proxy) |
| GET | `/models/:slug/header` | `content.ModelHeader` | Header image (R2 proxy) |
| GET | `/models/:slug/thumbnail` | `content.ModelAvatar` | Alias na avatar |
| GET | `/countries` | `models.ListCountries` | Lista krajów |
| GET | `/settings/public` | `models.GetPublicSettings` | Publiczne ustawienia (ceny) |
| GET | `/credit-packages` | `credits.ListPackages` | Lista pakietów kredytów |
| GET | `/content/:id/thumbnail` | `content.Thumbnail` | Thumbnail (OptionalAuth) |
| GET | `/content/:id/thumbnail/:filename` | `content.Thumbnail` | Thumbnail z filename |

## 🔒 Auth Required (OptionalAuth — zwraca dane jeśli zalogowany)

| Method | Path | Handler | Opis |
|---|---|---|---|
| GET | `/models/:modelId/access` | `models.CheckAccess` | Sprawdź dostęp usera do modelu |
| GET | `/user/access` | `models.GetUserAccess` | Dostęp usera (bundle + modelIds) |
| GET | `/content/:slug/:contentItemId/details` | `content.GetContentDetails` | Szczegóły contentu |

## 🔐 Auth Required (Authenticate)

| Method | Path | Handler | Opis |
|---|---|---|---|
| GET | `/auth/me` | `auth.Me` | Dane zalogowanego usera |
| POST | `/credits/purchase` | `credits.CreatePurchase` | Utwórz zakup kredytów |
| POST | `/credits/purchase/:id/proof` | `credits.UploadProof` | Upload dowodu wpłaty |
| GET | `/credits/purchase/:id/status` | `credits.GetPurchaseStatus` | Status zakupu |
| GET | `/credits/purchase/:id/stream` | `credits.StreamPurchaseStatus` | SSE stream statusu |
| POST | `/credits/purchase/:id/txid` | `credits.SubmitTxId` | Podaj txId (crypto) |
| POST | `/credits/purchase/:id/blik` | `credits.UpdateBlikCode` | Aktualizuj kod BLIK |
| GET | `/credits/purchase` | `credits.ListPurchases` | Lista zakupów usera |
| GET | `/credits/purchase/:id/blik` | `credits.BlikWebSocket` | WebSocket BLIK |
| POST | `/purchases` | `purchases.Create` | Kup dostęp (wydaj kredyty) |
| GET | `/purchases` | `purchases.List` | Lista zakupów dostępu |
| POST | `/favorites` | `favorites.Toggle` | Toggle ulubione |
| GET | `/favorites` | `favorites.List` | Lista ulubionych |
| POST | `/favorites/check` | `favorites.BatchCheck` | Batch check ulubionych |
| GET | `/notifications` | `notifications.List` | Lista powiadomień |
| PATCH | `/notifications` | `notifications.MarkAllRead` | Oznacz jako przeczytane |
| GET | `/user/balance` | `user.GetBalance` | Saldo kredytów |
| GET | `/content/:id/playlist/:filename` | `content.Playlist` | HLS playlist (auth) |
| GET | `/content/:id/segment/:filename` | `content.Segment` | HLS segment (token) |

## 👑 Admin Routes (`/api/admin/*`)

> Require: Authenticate + RequireAdmin

| Method | Path | Handler | Opis |
|---|---|---|---|
| GET | `/admin/credits/purchases` | `admin.ListCreditPurchases` | Oczekujące zakupy |
| GET | `/admin/credits/purchases/stream` | `admin.StreamPendingPurchases` | SSE stream zakupów |
| POST | `/admin/credits/purchases/:id/approve` | `admin.ApprovePurchase` | Zatwierdź zakup |
| POST | `/admin/credits/purchases/:id/reject` | `admin.RejectPurchase` | Odrzuć zakup |
| GET | `/admin/users` | `admin.ListUsers` | Lista użytkowników |
| GET | `/admin/users/:id` | `admin.GetUser` | Szczegóły usera |
| PATCH | `/admin/users/:id` | `admin.UpdateUser` | Aktualizuj usera |
| DELETE | `/admin/users/:id` | `admin.DeleteUser` | Usuń usera |
| POST | `/admin/users/:id/credits` | `admin.UpdateUserCredits` | Zmień saldo kredytów |
| POST | `/admin/users/:id/ban` | `admin.ToggleBan` | Ban / unban |
| POST | `/admin/users/:id/access` | `admin.GrantAccess` | Nadaj dostęp |
| DELETE | `/admin/users/:id/access` | `admin.RevokeAccess` | Odbierz dostęp |
| GET | `/admin/packages` | `admin.ListPackages` | Lista pakietów |
| POST | `/admin/packages` | `admin.CreatePackage` | Utwórz pakiet |
| PATCH | `/admin/packages/:id` | `admin.UpdatePackage` | Edytuj pakiet |
| DELETE | `/admin/packages/:id` | `admin.DeletePackage` | Usuń pakiet |
| GET | `/admin/models` | `admin.ListModels` | Lista modeli (admin) |
| PATCH | `/admin/models` | `admin.UpdateModel` | Edytuj model |
| PATCH | `/admin/content/hidden` | `admin.ToggleContentHidden` | Ukryj/pokaż content |
| GET | `/admin/settings` | `admin.GetSettings` | Wszystkie ustawienia |
| PUT | `/admin/settings` | `admin.UpdateSettings` | Zmień ustawienia |
| POST | `/admin/r2/sync` | `admin.SyncR2` | Ręczna sync R2 |
| POST | `/admin/r2/import` | `admin.ImportR2` | Import z R2 |
| POST | `/admin/r2/avatars` | `admin.UploadAvatar` | Upload avatara |
| GET | `/admin/analytics` | `admin.GetAnalytics` | Analityka |

## Health & Utility

| Method | Path | Opis |
|---|---|---|
| GET | `/health` | Health check (`{"status":"ok"}`) |
