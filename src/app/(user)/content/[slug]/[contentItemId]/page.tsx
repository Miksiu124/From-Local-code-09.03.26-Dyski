import { notFound, redirect } from "next/navigation";
import { getServerUser } from "@/lib/session-server";
import { fetchApi } from "@/lib/api-client";
import { ContentViewer } from "@/components/user/content-viewer";

interface Props {
  params: Promise<{ slug: string; contentItemId: string }>;
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

export default async function ContentViewPage({ params }: Props) {
  const { slug, contentItemId } = await params;
  const sessionUser = await getServerUser();

  if (!sessionUser) redirect("/login");

  const data = await fetchApi<ContentDetailsResponse>(
    `/content/${slug}/${contentItemId}/details`
  );

  if (!data) notFound();

  if (!data.hasAccess) {
    redirect(`/models/${slug}`);
  }

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
      />
    </div>
  );
}
