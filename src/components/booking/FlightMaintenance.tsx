import { Link } from "@tanstack/react-router";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Frontend-only switch: while true, no Flight search, review, checkout or booking can start. */
export const FLIGHTS_UNDER_MAINTENANCE = true;

export function FlightMaintenanceNotice({ fullPage = false }: { fullPage?: boolean }) {
  const body = (
    <div role="status" className="flex flex-col items-start gap-3 border border-foreground/10 bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 text-primary">
        <Wrench className="size-5 shrink-0" aria-hidden="true" />
        <h2 className="font-display text-xl">Flights are under maintenance</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Flight search and booking are temporarily unavailable while we carry out maintenance. No flight bookings or payments can be started right now. Hotels and holiday packages are available as usual.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild><Link to="/hotels">Search hotels</Link></Button>
        <Button asChild variant="outline"><Link to="/">Back to home</Link></Button>
      </div>
    </div>
  );
  if (!fullPage) return body;
  return <main className="container mx-auto max-w-3xl px-4 py-16 sm:py-24">{body}</main>;
}
