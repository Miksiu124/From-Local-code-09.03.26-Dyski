# Baza danych — Schema

> Zdefiniowana w `prisma/schema.prisma` (Prisma) i `backend/migrations/` (SQL)
> Go backend korzysta bezpośrednio z pgx (raw SQL), frontend z Prisma Client

## Modele (tabele)

### users
Główna tabela użytkowników.
| Kolumna | Typ | Opis |
|---|---|---|
| id | cuid | PK |
| email | String (unique) | Email |
| password | String? | Hasło (bcrypt, null dla OAuth) |
| name | String? | Nazwa |
| discord_id | String? (unique) | Discord ID |
| role | Enum: USER / ADMIN | Rola |
| credit_balance | Int (default 0) | Saldo kredytów |
| is_banned | Boolean | Czy zbanowany |
| last_login_at | DateTime? | Ostatnie logowanie |

### accounts / sessions / verification_tokens
Tabele NextAuth — adapter Prisma.

### countries
Kraje z kodem ISO i emoji flagą.
| Kolumna | Typ |
|---|---|
| name | String |
| code | String (unique, ISO alpha-2) |
| flag_emoji | String? |

### models
Modele (twórcy contentu). Mapowane 1:1 na foldery R2.
| Kolumna | Typ | Opis |
|---|---|---|
| name | String | Displayowa nazwa |
| folder_name | String (unique) | Nazwa folderu w R2 |
| avatar_path | String? | Ścieżka do avatara w R2 |
| country_id | String? (FK) | Kraj |
| is_active | Boolean | Aktywny? |
| is_featured | Boolean | Wyróżniony? (karuzela) |
| last_synced_at | DateTime? | Ostatni sync z R2 |

### content_items
Pojedyncze pliki contentu (video/photo).
| Kolumna | Typ | Opis |
|---|---|---|
| model_id | FK → models | Przynależność |
| unique_id | String (unique) | Unikalny ID z R2 |
| content_type | Enum: VIDEO / PHOTO | Typ |
| thumbnail_path | String? | Ścieżka thumbnail w R2 |
| source_video_path | String? | Ścieżka źródłowego video |
| hls_master_path | String? | Ścieżka master.m3u8 |
| hls_folder_path | String? | Folder HLS |
| duration | Int? | Czas trwania (sek) |
| is_active | Boolean | Aktywny? |
| is_hidden | Boolean | Ukryty? (admin) |

### credit_packages
Pakiety kredytów do kupienia.
| Kolumna | Typ |
|---|---|
| name | String (np. "Starter Pack") |
| credits | Int |
| price | Float (USD) |
| tier | Int (sortowanie) |
| is_active | Boolean |

### credit_purchases
Zakupy kredytów (oczekujące → zatwierdzone/odrzucone).
| Kolumna | Typ | Opis |
|---|---|---|
| user_id | FK | Kupujący |
| credit_package_id | FK | Pakiet |
| payment_method | Enum: BLIK / CRYPTO / PAYPAL / REVOLUT | Metoda |
| transaction_code | String (unique) | Kod transakcji |
| blik_code | String? | Kod BLIK |
| crypto_currency | Enum? | BTC/ETH/USDT/USDC |
| tx_id | String? | ID transakcji crypto |
| status | Enum: PENDING / APPROVED / REJECTED / EXPIRED | Status |
| expiration_time | DateTime | Wygasa o |
| admin_id | FK? | Admin który zatwierdził |

### purchases
Zakupy dostępu do treści (wydanie kredytów).
| Kolumna | Typ | Opis |
|---|---|---|
| user_id | FK | Użytkownik |
| model_id | FK? | null = bundle |
| purchase_type | Enum: INDIVIDUAL_MODEL / BUNDLE | Typ |
| access_duration | Enum?: 7_DAYS / 14_DAYS / 30_DAYS | Czas |
| credits_spent | Int | Koszt |

### credit_transactions
Historia transakcji kredytowych.
| Kolumna | Typ |
|---|---|
| user_id | FK |
| type | Enum: PURCHASE / SPEND / REFUND / ADJUSTMENT |
| amount | Int (+ = add, - = deduct) |
| description | String |

### user_access
Dostęp użytkownika do modeli.
| Kolumna | Typ | Opis |
|---|---|---|
| user_id | FK | Użytkownik |
| model_id | FK? | null = bundle (wszystkie) |
| purchase_id | FK | Powiązany zakup |
| expires_at | DateTime? | null = lifetime |

### notifications
Powiadomienia dla użytkowników.
| Kolumna | Typ |
|---|---|
| type | Enum: PAYMENT_APPROVED/REJECTED/EXPIRED, NEW_MODEL, PURCHASE_COMPLETE |
| title | String |
| message | String |
| is_read | Boolean |
| metadata | JSON? |

### favorites
Ulubione content items.
- unique constraint: `(user_id, content_item_id)`

### settings
Key-value store do konfiguracji.
- `key` (unique String), `value` (JSON)
- Używany do: cen modeli/bundle, adresów crypto, adresów PayPal/Revolut, ustawień BLIK

## Migracje

Pliki w `backend/migrations/` — ładowane automatycznie przy starcie PostgreSQL (initdb).
Aktualnie 15 migracji (001_initial → 20260225000000_add_is_hidden).
