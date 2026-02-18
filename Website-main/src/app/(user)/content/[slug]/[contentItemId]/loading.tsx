export default function ContentViewLoading() {
  return (
    <div className="container mx-auto px-4 py-8 animate-pulse">
      {/* Back link */}
      <div className="h-4 w-32 bg-muted rounded mb-6" />

      {/* Video player placeholder */}
      <div className="aspect-video rounded-xl bg-muted" />
    </div>
  );
}
