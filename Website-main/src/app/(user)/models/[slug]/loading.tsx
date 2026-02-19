export default function ModelDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="h-4 w-24 bg-white/[0.04] rounded-lg mb-4 animate-pulse" />

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="h-8 w-48 bg-white/[0.04] rounded-xl mb-2 animate-pulse" />
          <div className="h-4 w-24 bg-white/[0.04] rounded-lg mb-2 animate-pulse" />
          <div className="h-3 w-16 bg-white/[0.04] rounded-lg animate-pulse" />
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-20 bg-white/[0.04] rounded-xl animate-pulse" />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-xl bg-white/[0.04] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
