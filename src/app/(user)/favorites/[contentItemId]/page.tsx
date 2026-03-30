import { notFound, redirect } from "next/navigation";
import { getServerUser } from "@/lib/session-server";
import { fetchApi } from "@/lib/api-client";
import { ContentViewer } from "@/components/user/content-viewer";

interface Props {
  params: Promise<{ contentItemId: string }>;
  searchParams: Promise<{ filter?: string; sort?: string }>;
}

interface ContentDetailsResponse {
  model: { id: string; name: string; folderName: string };
  contentItem: {
    id: string;
    contentType: string;
    thumbnailPath: string | null;
    hlsMasterPath: string | null;
    duration: number | null;
    thumbnailUrl?: string;
  };
  hasAccess: boolean;
  prevItemId: string | null;
  nextItemId: string | null;
}

export default async function FavoritesContentViewPage({ params, searchParams }: Props) {
  const { contentItemId } = await params;
  const { filter = "ALL", sort = "newest" } = await searchParams;
  const sessionUser = await getServerUser();

  if (!sessionUser) redirect("/login?callbackUrl=/favorites");

  const query = new URLSearchParams();
  if (filter !== "ALL") query.set("filter", filter);
  if (sort !== "newest") query.set("sort", sort);
  const queryStr = query.toString();

  const data = await fetchApi<ContentDetailsResponse>(
    `/favorites/${contentItemId}/details${queryStr ? `?${queryStr}` : ""}`
  );

  if (!data) notFound();

  if (!data.hasAccess) {
    redirect("/favorites");
  }

  const backHref = queryStr ? `/favorites?${queryStr}` : "/favorites";

  return (
    <div className="container mx-auto px-4 py-8">
      <ContentViewer
        contentItemId={data.contentItem.id}
        contentType={data.contentItem.contentType}
        modelName={data.model.name}
        modelSlug={data.model.folderName}
        prevItemId={data.prevItemId}
        nextItemId={data.nextItemId}
        thumbnailUrl={data.contentItem.thumbnailUrl ?? null}
        backHref={backHref}
        backLabel="Back to Favorites"
        navBasePath="/favorites"
        detailsApiPath="/api/favorites"
        searchParamsForNav={queryStr ? `?${queryStr}` : undefined}
      />
    </div>
  );
}
