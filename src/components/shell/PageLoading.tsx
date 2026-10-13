/** Suspense fallback for page content. */
export function PageLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 rounded-lg bg-black/10" />
      <div className="h-28 rounded-xl bg-black/5" />
      <div className="h-28 rounded-xl bg-black/5" />
    </div>
  );
}
