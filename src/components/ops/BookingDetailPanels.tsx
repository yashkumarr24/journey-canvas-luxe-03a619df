/**
 * Product-specific detail panels for a booking.
 *
 * Everything rendered comes from the Phase 7–9 booking summary already stored
 * against the booking — no itinerary or rate data is recomputed or invented.
 * Document numbers arrive already masked from the backend and are printed as-is.
 */

import { formatMoney, formatTime } from "@/lib/flight-search";
import type { BookingDetail } from "@/types/operations";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
      <h3 className="font-display text-lg tracking-tight text-foreground">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function day(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function BookingDetailPanels({ detail }: { detail: BookingDetail }) {
  const flight = detail.flight;
  const hotel = detail.hotel;

  if (!flight && !hotel) {
    return (
      <Card title="Booking details">
        <p className="text-sm text-muted-foreground">
          The full itinerary for this record isn&apos;t available. The reference, status and amount
          above are the authoritative values.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {flight ? (
        <>
          <Card title="Itinerary">
            <div className="space-y-5">
              {flight.itineraries.map((itinerary, index) => (
                <div key={`${itinerary.direction}-${index}`}>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {itinerary.direction === "inbound" ? "Return" : "Outbound"}
                  </p>
                  {itinerary.segments.map((segment) => (
                    <div key={segment.id} className="mt-2 rounded-xl border border-foreground/10 bg-background/60 p-3">
                      <p className="text-sm font-medium text-foreground">
                        {segment.airline.name || segment.airline.code}
                        {segment.flightNumber ? ` · ${segment.flightNumber}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {segment.origin.code} {formatTime(segment.departureAt)} →{" "}
                        {segment.destination.code} {formatTime(segment.arrivalAt)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {day(segment.departureAt)}
                        {segment.cabinClass ? ` · ${segment.cabinClass}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Travellers">
            <ul className="space-y-2 text-sm">
              {flight.travellers.map((traveller, index) => (
                <li key={`${traveller.fullName}-${index}`} className="rounded-xl border border-foreground/10 bg-background/60 px-3 py-2">
                  <p className="text-foreground">
                    {traveller.title ? `${traveller.title} ` : ""}
                    {traveller.fullName}
                    <span className="ml-2 text-xs text-muted-foreground">{traveller.type}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      traveller.nationality,
                      traveller.passportNumber ? `Document ${traveller.passportNumber}` : null,
                      traveller.ticketNumber ? `Ticket ${traveller.ticketNumber}` : "Ticket number pending",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Fare summary">
            <div className="divide-y divide-foreground/8">
              {flight.breakdown.map((line, index) => (
                <Row
                  key={`${line.label}-${index}`}
                  label={line.label}
                  value={formatMoney(line.amount.amount, line.amount.currency)}
                />
              ))}
              <Row
                label="Total paid"
                value={formatMoney(flight.totalPayable.amount, flight.totalPayable.currency)}
              />
              <Row label="Airline PNR" value={flight.pnr ?? "Pending"} />
              <Row label="Airline reference" value={flight.airlineBookingReference ?? "Pending"} />
            </div>
          </Card>
        </>
      ) : null}

      {hotel ? (
        <>
          <Card title="Stay">
            <div className="divide-y divide-foreground/8">
              <Row label="Hotel" value={hotel.hotel.name} />
              <Row
                label="Location"
                value={hotel.hotel.location?.address || hotel.hotel.location?.city}
              />
              <Row label="Check-in" value={`${day(hotel.stay.checkIn)}${hotel.hotel.checkInTime ? ` · ${hotel.hotel.checkInTime}` : ""}`} />
              <Row label="Check-out" value={`${day(hotel.stay.checkOut)}${hotel.hotel.checkOutTime ? ` · ${hotel.hotel.checkOutTime}` : ""}`} />
              <Row label="Nights" value={hotel.stay.nights} />
              <Row label="Room" value={`${hotel.room.roomCount} × ${hotel.room.roomName}`} />
              <Row label="Meal plan" value={hotel.room.mealPlan ?? "Room only"} />
              <Row label="Cancellation policy" value={hotel.room.cancellation.summary ?? hotel.room.cancellation.type} />
              <Row label="Hotel confirmation" value={hotel.hotelConfirmationNumber ?? "Pending"} />
            </div>
          </Card>

          <Card title="Guests">
            <ul className="space-y-2 text-sm">
              {hotel.guests.map((guest, index) => (
                <li key={`${guest.fullName}-${index}`} className="rounded-xl border border-foreground/10 bg-background/60 px-3 py-2">
                  <p className="text-foreground">
                    {guest.title ? `${guest.title} ` : ""}
                    {guest.fullName}
                    {guest.isLead ? <span className="ml-2 text-xs text-gold">Lead guest</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Room {guest.roomIndex} · {guest.type}
                    {guest.nationality ? ` · ${guest.nationality}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Price breakdown">
            <div className="divide-y divide-foreground/8">
              {hotel.breakdown.map((line, index) => (
                <Row
                  key={`${line.label}-${index}`}
                  label={line.label}
                  value={formatMoney(line.amount.amount, line.amount.currency)}
                />
              ))}
              <Row
                label="Total paid"
                value={formatMoney(hotel.totalPayable.amount, hotel.totalPayable.currency)}
              />
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
