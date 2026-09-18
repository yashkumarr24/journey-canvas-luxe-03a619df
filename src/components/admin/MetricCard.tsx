/**
 * Dashboard metric tile.
 *
 * Every tile states exactly what it counts (`hint`) so no number on the
 * dashboard is ambiguous — an event count is never mistaken for a session
 * count or a user count.
 */

import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  suffix,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone?: "default" | "positive" | "negative";
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "positive" && "text-emerald-600",
          tone === "negative" && "text-destructive",
          tone === "default" && "text-foreground",
        )}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
        {suffix ? <span className="ml-0.5 text-base font-normal">{suffix}</span> : null}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{children}</div>
  );
}
