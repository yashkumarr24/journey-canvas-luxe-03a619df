import { Mail, Phone, User } from "lucide-react";
import type { HotelContactInput, HotelGuestSummaryItem } from "@/types/booking";

/** Guest and contact summary, grouped by room. Values come from the server. */

export interface HotelGuestSummaryProps {
  guests: HotelGuestSummaryItem[];
  contact: HotelContactInput;
  specialRequests?: string;
}

export function HotelGuestSummary({ guests, contact, specialRequests }: HotelGuestSummaryProps) {
  const rooms = [...new Set(guests.map((guest) => guest.roomIndex))].sort((a, b) => a - b);

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Guests</p>

      {guests.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No guest details captured yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {rooms.map((roomIndex) => (
            <div key={roomIndex} className="rounded-2xl border border-foreground/10 p-4">
              <p className="text-sm font-medium">Room {roomIndex}</p>
              <ul className="mt-2 space-y-2">
                {guests
                  .filter((guest) => guest.roomIndex === roomIndex)
                  .map((guest, index) => (
                    <li key={`${guest.fullName}-${index}`} className="flex items-start gap-2 text-sm">
                      <User className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0">
                        {[guest.title, guest.fullName].filter(Boolean).join(" ")}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {guest.type === "child" ? `Child${guest.age !== undefined ? `, ${guest.age}` : ""}` : "Adult"}
                          {guest.isLead ? " · Lead guest" : ""}
                          {guest.nationality ? ` · ${guest.nationality}` : ""}
                        </span>
                        {guest.panNumber && (
                          <span className="block text-xs text-muted-foreground">PAN {guest.panNumber}</span>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-2 border-t border-foreground/10 pt-5 text-sm">
        <p className="flex items-center gap-2">
          <Mail className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {contact.email}
        </p>
        <p className="flex items-center gap-2">
          <Phone className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {[contact.dialCode, contact.phone].filter(Boolean).join(" ")}
        </p>
      </div>

      {specialRequests && (
        <div className="mt-4 rounded-2xl border border-dashed border-foreground/15 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Special requests</p>
          <p className="mt-2 text-sm text-muted-foreground">{specialRequests}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Requests are passed to the hotel and are subject to availability on arrival.
          </p>
        </div>
      )}
    </div>
  );
}
