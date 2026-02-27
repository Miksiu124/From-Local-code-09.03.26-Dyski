import type { MetadataRoute } from "next";
import { fetchApi } from "@/lib/api-client";

type Model = {
  id: string;
  folderName: string;
};

type ModelsResponse = {
  models: Model[];
  nextCursor: string | null;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://contentvault.io").replace(/\/+$/, "");

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${baseUrl}/login`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/register`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/purchase`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];

  let modelPages: MetadataRoute.Sitemap = [];
  try {
    const data = await fetchApi<ModelsResponse>("/models?limit=500");
    modelPages = data.models.map((model) => ({
      url: `${baseUrl}/models/${model.folderName}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // If API fails, return static pages only
  }

  return [...staticPages, ...modelPages];
}
