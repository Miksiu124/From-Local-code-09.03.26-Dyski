export default function ModelsLoading() {
  return (
    <div className="container mx-auto px-4 py-8 animate-pulse">
      {/* Title skeleton */}
      <div className="mb-8">
        <div className="h-8 w-40 bg-muted rounded-lg" />
      </div>

      {/* Top creators skeleton */}
      <div className="mb-8">
        <div className="h-5 w-32 bg-muted rounded mb-4" />
        <div className="flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-20 w-20 rounded-full bg-muted" />
              <div className="h-3 w-14 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Search skeleton */}
      <div className="mb-6">
        <div className="h-10 bg-muted rounded-lg mb-4" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-20 bg-muted rounded-full" />
          ))}
        </div>
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
