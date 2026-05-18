import { describe, it, expect, afterEach } from "vitest";
import { apexHostname, getSiteUrl, isWwwHost } from "./site-url";

describe("site-url", () => {
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  const prevBase = process.env.NEXT_PUBLIC_BASE_URL;

  afterEach(() => {
    if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevApp;
    if (prevBase === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = prevBase;
  });

  it("strips www from configured origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.dyskiof.net/";
    expect(getSiteUrl()).toBe("https://dyskiof.net");
  });

  it("detects www host", () => {
    expect(isWwwHost("www.dyskiof.net")).toBe(true);
    expect(isWwwHost("dyskiof.net")).toBe(false);
  });

  it("normalizes apex hostname", () => {
    expect(apexHostname("www.dyskiof.net:443")).toBe("dyskiof.net");
  });
});
