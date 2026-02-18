import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  // Check cookie first, then Accept-Language header, default to 'en'
  let locale = cookieStore.get("locale")?.value;

  if (!locale) {
    const acceptLanguage = headerStore.get("accept-language") || "";
    if (acceptLanguage.includes("pl")) {
      locale = "pl";
    }
  }

  if (!locale || !["en", "pl"].includes(locale)) {
    locale = "en";
  }

  return {
    locale,
    timeZone: "UTC",
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
