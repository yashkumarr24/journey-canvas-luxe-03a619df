import { Link } from "@tanstack/react-router";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Customer-facing flag: flight search, checkout and booking are paused. */
export const FLIGHTS_UNDER_MAINTENANCE = true;

export function FlightMaintenanceNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div role="status" className={compact ? "py-4 text-center" : "mx-auto max-w-xl px-4 py-24 text-center"}>
      <Wrench className="mx-auto size-8 text-gold" aria-hidden="true" />
      <h2 className="mt-3 font-display text-2xl">Flights are under maintenance</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Flight search and booking are temporarily unavailable while we carry out improvements. Hotels and holiday packages are available as usual.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button asChild><Link to="/hotels">Search hotels</Link></Button>
        {!compact && <Button asChild variant="outline"><Link to="/">Back to home</Link></Button>}
      </div>
    </div>
  );
}

export function FlightMaintenancePage() {
  return <main className="min-h-[60vh]"><FlightMaintenanceNotice /></main>;
}
