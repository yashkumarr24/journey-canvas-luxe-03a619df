import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder matching the hotel result card layout. */
export function HotelResultsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Searching hotels…</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-3xl border border-foreground/10 bg-card sm:flex">
          <Skeleton className="aspect-[4/3] w-full sm:aspect-auto sm:h-48 sm:w-64" />
          <div className="flex-1 space-y-3 p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}
