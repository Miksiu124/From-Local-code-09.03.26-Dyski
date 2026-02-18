import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ContentViewer } from "@/components/user/content-viewer";

interface Props {
  params: Promise<{ slug: string; contentItemId: string }>;
}

export default async function ContentViewPage({ params }: Props) {
  const { slug, contentItemId } = await params;
  const session = await auth();

  if (!session) redirect("/login");

  // Find model by folderName (slug)
  const model = await db.model.findUnique({
    where: { folderName: slug, isActive: true },
    select: { id: true, name: true, folderName: true },
  });

  if (!model) notFound();

  const contentItem = await db.contentItem.findUnique({
    where: { id: contentItemId, isActive: true },
  });

  if (!contentItem || contentItem.modelId !== model.id) {
    notFound();
  }

  // Check access
  const access = await db.userAccess.findFirst({
    where: {
      userId: session.user.id,
      AND: [
        { OR: [{ modelId: model.id }, { modelId: null }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ],
    },
  });

  if (!access) {
    redirect(`/models/${slug}`);
  }

  // Fetch prev/next content item IDs for keyboard navigation
  const [prevItem, nextItem] = await Promise.all([
    db.contentItem.findFirst({
      where: {
        modelId: model.id,
        isActive: true,
        createdAt: { gt: contentItem.createdAt },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    db.contentItem.findFirst({
      where: {
        modelId: model.id,
        isActive: true,
        createdAt: { lt: contentItem.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);

  return (
    <div className="container mx-auto px-4 py-8">
      <ContentViewer
        contentItemId={contentItem.id}
        contentType={contentItem.contentType}
        modelName={model.name}
        modelSlug={model.folderName}
        prevItemId={prevItem?.id || null}
        nextItemId={nextItem?.id || null}
      />
    </div>
  );
}
