"use client";

import { GrowthSessionTracker } from "@/components/growth/growth-session-tracker";

/** Growth funnel: server-logged events via /api/growth-hacker (session_start, etc.). */
export function GrowthFunnelChrome() {
  return <GrowthSessionTracker />;
}
