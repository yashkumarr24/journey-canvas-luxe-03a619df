/**
 * Local test helpers.
 *
 * Generates synthetic ANALYTICS sessions only — no bookings, no payments, no
 * provider calls, nothing in a real business table. Hidden entirely once a live
 * backend is configured.
 */

import { useState } from "react";

import { useMockAnalytics } from "@/lib/analytics/analytics-api";
import { clearDemoActivity, seedDemoActivity } from "@/lib/analytics/demo-seed";
import { Button } from "@/components/ui/button";

export function DemoActivityControls() {
  const [message, setMessage] = useState<string | null>(null);
  if (!useMockAnalytics) return null;

  return (
    <section className="mt-8 rounded-lg border border-dashed border-border bg-background p-4">
      <h2 className="text-sm font-semibold text-foreground">Test data</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Create sample visitor journeys (guest and signed-in, flights and hotels, booked, failed and
        abandoned) to check the dashboard, funnel and journey views. Analytics only — no bookings or
        payments are created.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const added = seedDemoActivity({ sessions: 12, days: 7 });
            setMessage(`${added} sample journeys added.`);
          }}
        >
          Add 12 sample journeys
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            clearDemoActivity();
            setMessage("Sample journeys removed.");
          }}
        >
          Clear sample data
        </Button>
      </div>
      {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
    </section>
  );
}
