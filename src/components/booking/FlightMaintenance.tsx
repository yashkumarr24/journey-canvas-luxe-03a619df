import { PlaneTakeoff, Wrench } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

export function FlightMaintenanceNotice() {
  return (
    <div role="status" className="flex items-start gap-4 py-5">
      <Wrench className="mt-1 size-6 shrink-0 text-gold" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-display text-2xl">Under Maintenance</p>
        <p className="mt-2 text-sm text-muted-foreground">Flight search, checkout and booking are temporarily unavailable.</p>
      </div>
    </div>
  );
}

export function FlightMaintenancePage() {
  return (
    <>
      <Nav />
      <main className="mx-auto min-h-[60vh] max-w-7xl px-6 pb-20 pt-36">
        <div className="mb-6 flex items-center gap-3">
          <PlaneTakeoff className="size-7 text-gold" aria-hidden="true" />
          <h1 className="font-display text-4xl">Flights</h1>
        </div>
        <FlightMaintenanceNotice />
      </main>
      <Footer />
    </>
  );
}