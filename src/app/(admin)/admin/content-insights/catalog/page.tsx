import { CatalogEngagementPanel } from "@/components/admin/catalog-engagement-panel";
import { ContentInsightsShell } from "../content-insights-shell";

export default function ContentInsightsCatalogPage() {
  return (
    <ContentInsightsShell>
      <CatalogEngagementPanel />
    </ContentInsightsShell>
  );
}
