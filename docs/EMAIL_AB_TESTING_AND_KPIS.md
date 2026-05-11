# A/B testing and KPIs (90-day optimization loop)

Use this with [`docs/EMAIL_LIFECYCLE_SEGMENTS.md`](EMAIL_LIFECYCLE_SEGMENTS.md) and [`docs/MARKETING_CAMPAIGNS.md`](MARKETING_CAMPAIGNS.md).

## Weekly KPI set (minimum)

| KPI | Definition | Source |
|-----|------------|--------|
| Email-attributed sessions | Visits with `utm_*` or custom link slug from mail CTA | `link_visits`, frontend analytics |
| Checkout → paid | `checkout_started` → `purchase_completed` (same `user_id`, time-ordered) | `growth_events` |
| Revenue / 1k sends | Gross approved credits revenue / marketing sends (by campaign) | `credit_purchases`, `marketing_campaign_sends` |
| Complaint / bounce proxy | Resend dashboard + hard bounces | Provider |
| Unsubscribe rate | Unsubscribe events / sends | App logs when implemented |

## Built-in A/B pattern (repeat buyer)

`REPEAT_BUYER_AB_LINK_SLUGS` + custom links (`vip10-a`, `vip10-b`, `vip10-c`) — see [`MARKETING_CAMPAIGNS.md`](MARKETING_CAMPAIGNS.md). Extend the same pattern for welcome or starter CTAs by:

1. Creating two custom link slugs pointing at the same landing path with different `utm_email_ab` query values.
2. Splitting users by `user_id` hash or round-robin in a small Go helper (future).
3. Comparing `link_visits` and downstream `purchase_completed`.

## 90-day experiment cadence

| Weeks | Focus |
|-------|--------|
| 1–2 | Transactional baseline + deliverability (SPF/DKIM/DMARC); welcome on verify. |
| 3–4 | Starter offer cron + checkout abandonment delay tuning (`CHECKOUT_REMINDER_*`). |
| 5–8 | At-risk + lapsed bands vs. winback overlap; adjust `AT_RISK_*` / `LAPSED_*` days. |
| 9–12 | Subject/CTA A/B on one campaign at a time; hold other copy fixed. |

## Grafana / SQL starters

- Funnel steps: admin **Growth funnel** or `growth_events` counts for `signup_completed` → `email_verified` → `checkout_started` → `purchase_completed`.
- Lifecycle audit: `event_name IN ('lifecycle_welcome_sent','lifecycle_starter_offer_sent','lifecycle_at_risk_sent','lifecycle_lapsed_sent')`.
- Cooldown compliance: join `users` to `marketing_campaign_sends` grouped by `campaign`.

## Rules of thumb

- One active A/B per campaign family (avoid overlapping subject tests on the same audience).
- After a loss, revert winning arm and archive variant in git + `MARKETING_EMAIL_TEMPLATES.md`.
- If complaint rate rises, widen cooldowns and tighten weekly cap (`weeklyLifecycleEmailCapSQL` in `lifecycle_revenue.go`).
