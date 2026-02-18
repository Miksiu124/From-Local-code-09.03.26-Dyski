export default function ModelDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-8 animate-pulse">
      {/* Back link */}
      <div className="h-4 w-24 bg-muted rounded mb-4" />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="h-8 w-48 bg-muted rounded-lg mb-2" />
          <div className="h-4 w-24 bg-muted rounded mb-2" />
          <div className="h-4 w-16 bg-muted rounded" />
        </div>
        <div className="h-10 w-40 bg-muted rounded-lg" />
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}
