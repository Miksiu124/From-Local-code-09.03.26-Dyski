import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Seed countries
  const countries = [
    { name: "United States", code: "US", flagEmoji: "🇺🇸" },
    { name: "United Kingdom", code: "GB", flagEmoji: "🇬🇧" },
    { name: "Poland", code: "PL", flagEmoji: "🇵🇱" },
    { name: "Germany", code: "DE", flagEmoji: "🇩🇪" },
    { name: "France", code: "FR", flagEmoji: "🇫🇷" },
    { name: "Spain", code: "ES", flagEmoji: "🇪🇸" },
    { name: "Italy", code: "IT", flagEmoji: "🇮🇹" },
    { name: "Brazil", code: "BR", flagEmoji: "🇧🇷" },
    { name: "Canada", code: "CA", flagEmoji: "🇨🇦" },
    { name: "Australia", code: "AU", flagEmoji: "🇦🇺" },
    { name: "Japan", code: "JP", flagEmoji: "🇯🇵" },
    { name: "South Korea", code: "KR", flagEmoji: "🇰🇷" },
    { name: "Russia", code: "RU", flagEmoji: "🇷🇺" },
    { name: "Ukraine", code: "UA", flagEmoji: "🇺🇦" },
    { name: "Czech Republic", code: "CZ", flagEmoji: "🇨🇿" },
    { name: "Romania", code: "RO", flagEmoji: "🇷🇴" },
    { name: "Hungary", code: "HU", flagEmoji: "🇭🇺" },
    { name: "Colombia", code: "CO", flagEmoji: "🇨🇴" },
    { name: "Argentina", code: "AR", flagEmoji: "🇦🇷" },
    { name: "Mexico", code: "MX", flagEmoji: "🇲🇽" },
    { name: "Other", code: "XX", flagEmoji: "🌍" },
  ];

  for (const country of countries) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: {},
      create: country,
    });
  }
  console.log(`Seeded ${countries.length} countries`);

  // Seed default settings
  const settings = [
    {
      key: "model_credit_cost_7d",
      value: 30,
      description: "Credit cost for 7-day access to a single model",
    },
    {
      key: "model_credit_cost_30d",
      value: 50,
      description: "Credit cost for 30-day access to a single model",
    },
    {
      key: "bundle_credit_cost_14d",
      value: 500,
      description: "Credit cost for 14-day 'Buy All' bundle access",
    },
    {
      key: "bundle_credit_cost_30d",
      value: 900,
      description: "Credit cost for 30-day 'Buy All' bundle access",
    },
    {
      key: "default_country_id",
      value: "XX",
      description: "Default country code assigned to imported models",
    },
    {
      key: "blik_expiration_minutes",
      value: 5,
      description: "BLIK payment expiration time in minutes",
    },
    {
      key: "crypto_expiration_hours",
      value: 48,
      description: "Crypto payment expiration time in hours",
    },
    {
      key: "paypal_expiration_hours",
      value: 1,
      description: "PayPal payment expiration time in hours",
    },
    {
      key: "revolut_expiration_hours",
      value: 1,
      description: "Revolut payment expiration time in hours",
    },
    {
      key: "max_pending_credit_purchases",
      value: 3,
      description: "Maximum number of pending credit purchases per user (anti-spam)",
    },
    {
      key: "crypto_wallets",
      value: {
        BTC: "",
        ETH: "",
        LTC: "",
        USDC: "",
      },
      description: "Crypto wallet addresses (one per currency)",
    },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: {
        key: setting.key,
        value: setting.value,
        description: setting.description,
      },
    });
  }
  console.log(`Seeded ${settings.length} settings`);

  // Seed admin user
  const adminPassword = await bcrypt.hash("admin123", 12);
  await prisma.user.upsert({
    where: { email: "admin@contentvault.com" },
    update: {},
    create: {
      email: "admin@contentvault.com",
      password: adminPassword,
      name: "Admin",
      role: "ADMIN",
      creditBalance: 0,
    },
  });
  console.log("Seeded admin user (admin@contentvault.com / admin123)");

  // Seed default credit packages
  const packages = [
    // Prices in PLN (4 PLN = 1 USD)
    { name: "Starter", credits: 50, price: 20.0, tier: 1 },
    { name: "Popular", credits: 120, price: 40.0, tier: 2 },
    { name: "Pro", credits: 300, price: 100.0, tier: 3 },
    { name: "Ultimate", credits: 700, price: 200.0, tier: 4 },
  ];

  for (const pkg of packages) {
    const existing = await prisma.creditPackage.findFirst({
      where: { name: pkg.name },
    });
    if (!existing) {
      await prisma.creditPackage.create({ data: pkg });
    }
  }
  console.log(`Seeded ${packages.length} credit packages`);

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
