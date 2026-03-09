import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCredits(credits: number): string {
  return credits.toLocaleString();
}

export function getClientLocale(): string {
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
    if (match) return match[1];
  }
  if (typeof document !== "undefined") {
    return document.documentElement.lang || "en";
  }
  return "en";
}

/** Fixed exchange rate: 4 PLN = 1 USD (round up when converting PLN to USD) */
export const PLN_TO_USD = 4;

/** Convert PLN to USD, rounding up */
export function convertPlnToUsd(pln: number): number {
  return Math.ceil(pln / PLN_TO_USD);
}

/** Convert USD to PLN */
export function convertUsdToPln(usd: number): number {
  return usd * PLN_TO_USD;
}

/** Price is stored in PLN. For pl locale: show PLN. For en: show USD (ceil(pln/4) for totals, exact rate for per-credit) */
export function formatPrice(pricePln: number, locale?: string, options?: { exact?: boolean }): string {
  const loc = locale || getClientLocale();
  if (loc === "pl") {
    return new Intl.NumberFormat("pl-PL", {
      style: "currency",
      currency: "PLN",
    }).format(pricePln);
  }
  const usd = options?.exact ? pricePln / PLN_TO_USD : convertPlnToUsd(pricePln);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    ...(options?.exact && { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }).format(usd);
}

export function getCurrencySymbol(locale?: string): string {
  const loc = locale || getClientLocale();
  return loc === "pl" ? "PLN" : "USD";
}

export function generateTransactionCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const length = 6;
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(bytes[i] % chars.length);
  }
  return code;
}

export function getTimeRemaining(expirationTime: Date): {
  total: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
} {
  const total = expirationTime.getTime() - Date.now();
  const expired = total <= 0;

  return {
    total: Math.max(0, total),
    hours: expired ? 0 : Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: expired ? 0 : Math.floor((total / 1000 / 60) % 60),
    seconds: expired ? 0 : Math.floor((total / 1000) % 60),
    expired,
  };
}
