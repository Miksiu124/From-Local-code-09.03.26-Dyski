export default function RootLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="h-8 w-40 bg-white/[0.04] rounded-xl animate-pulse" />
      </div>

      <div className="mb-8">
        <div className="h-5 w-32 bg-white/[0.04] rounded-lg mb-4 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-auto lg:h-[420px]">
          <div className="lg:col-span-2 rounded-2xl bg-white/[0.04] min-h-[280px] animate-pulse" />
          <div className="flex flex-row lg:flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-xl bg-white/[0.04] min-h-[100px] animate-pulse" />
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="h-11 bg-white/[0.04] rounded-xl mb-3 animate-pulse" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-20 bg-white/[0.04] rounded-full animate-pulse" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-xl bg-white/[0.04] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
