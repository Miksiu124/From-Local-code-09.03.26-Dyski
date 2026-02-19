import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCredits(credits: number): string {
  return credits.toLocaleString();
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

export function generateTransactionCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const length = 12;
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
