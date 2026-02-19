export default function ContentViewLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div className="h-4 w-24 bg-white/[0.04] rounded-lg animate-pulse" />
        <div className="flex items-center gap-1.5">
          <div className="h-8 w-8 bg-white/[0.04] rounded-lg animate-pulse" />
          <div className="h-8 w-8 bg-white/[0.04] rounded-lg animate-pulse" />
          <div className="h-8 w-20 bg-white/[0.04] rounded-lg animate-pulse" />
        </div>
      </div>
      <div className="aspect-video rounded-2xl bg-white/[0.04] animate-pulse" />
    </div>
  );
}
