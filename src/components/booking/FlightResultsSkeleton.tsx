import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";

export function FlightResultsSkeleton() {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((value) => (value >= 92 ? 92 : value + Math.max(1, (95 - value) / 12)));
    }, 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Searching live fares — this can take a few seconds.
        </p>
        <Progress value={progress} className="mt-3 h-1.5" />
      </div>

      <div className="space-y-4">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6"
            aria-hidden="true"
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex-1 space-y-3">
                <Skeleton className="h-3 w-24" />
                <div className="flex items-center gap-4">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="h-3 w-40" />
              </div>
              <div className="space-y-3 lg:w-56">
                <Skeleton className="h-8 w-28 lg:ml-auto" />
                <Skeleton className="h-9 w-28 rounded-full lg:ml-auto" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Searching for flights, please wait.</span>
    </div>
  );
}
