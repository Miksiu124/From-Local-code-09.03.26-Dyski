import { ContentEngagementPanel } from "@/components/admin/content-engagement-panel";
import { ContentInsightsShell } from "../content-insights-shell";

export default function ContentInsightsEngagementPage() {
  return (
    <ContentInsightsShell>
      <ContentEngagementPanel />
    </ContentInsightsShell>
  );
}
