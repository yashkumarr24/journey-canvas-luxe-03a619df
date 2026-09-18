import { CalendarDays, MapPin, Users } from "lucide-react";
import { StarRating } from "@/components/booking/HotelResultCard";
import { CancellationLine } from "@/components/booking/HotelRoomCard";
import { formatStayDate, occupancyLabel } from "@/lib/hotel-search";
import type { HotelRoomOption, HotelStay, HotelSummary } from "@/types/booking";

/**
 * Shared hotel + room + stay summary, rendered on review, checkout and
 * confirmation so all three read from the same server data.
 */

export interface HotelStaySummaryProps {
  hotel: HotelSummary & { checkInTime?: string; checkOutTime?: string };
  room: HotelRoomOption;
  stay: HotelStay;
}

export function HotelStaySummary({ hotel, room, stay }: HotelStaySummaryProps) {
  const location = hotel.location;

  return (
    <div className="sm:flex sm:gap-6">
      {hotel.thumbnailUrl && (
        <img
          src={hotel.thumbnailUrl}
          alt={hotel.name}
          className="mb-4 aspect-[4/3] w-full rounded-2xl object-cover sm:mb-0 sm:w-48"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-display text-2xl leading-tight">{hotel.name}</h2>
          <StarRating rating={hotel.starRating} />
        </div>

        {location && (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {location.address ?? [location.area, location.city, location.country].filter(Boolean).join(", ")}
          </p>
        )}

        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Check-in</dt>
            <dd className="mt-1 text-sm">
              {formatStayDate(stay.checkIn)}
              {hotel.checkInTime && <span className="block text-xs text-muted-foreground">from {hotel.checkInTime}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Check-out</dt>
            <dd className="mt-1 text-sm">
              {formatStayDate(stay.checkOut)}
              {hotel.checkOutTime && (
                <span className="block text-xs text-muted-foreground">by {hotel.checkOutTime}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Stay</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-sm">
              <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {stay.nights} night{stay.nights > 1 ? "s" : ""}
            </dd>
          </div>
        </dl>

        <div className="mt-5 rounded-2xl border border-foreground/10 p-4">
          <p className="text-sm font-medium">{room.roomName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden="true" />
              {occupancyLabel(stay.rooms)}
            </span>
            {room.mealPlan && <span>{room.mealPlan}</span>}
            {room.bedType && <span>{room.bedType}</span>}
          </p>
          <div className="mt-2">
            <CancellationLine room={room} />
          </div>
        </div>
      </div>
    </div>
  );
}
