import { Mail, Phone, User } from "lucide-react";
import type { ContactInput, PassengerType, TravellerSummaryItem } from "@/types/booking";

const TYPE_LABEL: Record<PassengerType, string> = {
  adult: "Adult",
  child: "Child",
  infant: "Infant",
};

export interface TravellerSummaryProps {
  travellers: TravellerSummaryItem[];
  contact: ContactInput;
  /** Show issued ticket numbers (confirmation screen only). */
  showTickets?: boolean;
}

export function TravellerSummary({ travellers, contact, showTickets }: TravellerSummaryProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Travellers</p>

      {travellers.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Traveller details aren't available yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-foreground/10">
          {travellers.map((traveller, index) => (
            <li key={`${traveller.fullName}-${index}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">
                {traveller.title ? `${traveller.title} ` : ""}
                {traveller.fullName || "—"}
              </span>
              <span className="text-xs text-muted-foreground">{TYPE_LABEL[traveller.type]}</span>
              {traveller.passportNumber && (
                <span className="text-xs text-muted-foreground">Passport {traveller.passportNumber}</span>
              )}
              {showTickets && traveller.ticketNumber && (
                <span className="ml-auto text-xs text-muted-foreground">Ticket {traveller.ticketNumber}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-foreground/10 pt-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Mail className="size-4" aria-hidden="true" /> {contact.email || "—"}
        </span>
        <span className="flex items-center gap-2">
          <Phone className="size-4" aria-hidden="true" /> {contact.phone || "—"}
        </span>
      </div>
    </div>
  );
}
