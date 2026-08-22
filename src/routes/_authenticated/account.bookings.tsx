import { createFileRoute, Link } from "@tanstack/react-router";
import { Plane } from "lucide-react";

export const Route = createFileRoute("/_authenticated/account/bookings")({
  component: BookingsPage,
});

/**
 * Booking history intentionally does NOT read the `bookings` table from the
 * browser. Bookings are owned by the FastAPI service, which verifies the
 * Supabase bearer token and derives ownership server-side. This page will call
 * `GET /api/v1/bookings` through booking-api once that endpoint ships.
 */
function BookingsPage() {
  return (
    <section className="max-w-2xl rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="font-display text-xl tracking-tight text-foreground">Your bookings</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Every confirmed flight and hotel booking will appear here with its reference, travellers and
        payment status.
      </p>

      <div className="mt-6 rounded-2xl border border-dashed border-foreground/15 px-4 py-10 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-foreground/5 text-gold">
          <Plane className="size-5" aria-hidden />
        </span>
        <p className="mt-4 text-sm text-muted-foreground">
          No bookings yet. Once live booking is switched on, your trips will be listed here.
        </p>
        <Link
          to="/flights"
          className="mt-4 inline-block text-sm text-gold underline underline-offset-4"
        >
          Search flights
        </Link>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Booked as a guest? Use the reference and email from your confirmation on the booking lookup
        page — a guest booking is never attached to an account automatically.
      </p>
    </section>
  );
}
