import { BedDouble, Check, Loader2, ShieldCheck, Users, Utensils, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/flight-search";
import type { HotelRoomOption } from "@/types/booking";

/**
 * One sellable room/rate option. The card carries an opaque rate handle only;
 * selecting it sends no price to the server.
 */

export interface HotelRoomCardProps {
  room: HotelRoomOption;
  nights: number;
  selected?: boolean;
  selecting?: boolean;
  disabled?: boolean;
  onSelect?: (room: HotelRoomOption) => void;
}

export function CancellationLine({ room }: { room: HotelRoomOption }) {
  const refundable = room.cancellation?.refundable;
  const Icon = refundable ? ShieldCheck : XCircle;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${refundable ? "text-gold" : "text-muted-foreground"}`}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{room.cancellation?.summary ?? (refundable ? "Refundable rate" : "Non-refundable rate")}</span>
    </p>
  );
}

export function HotelRoomCard({
  room,
  nights,
  selected,
  selecting,
  disabled,
  onSelect,
}: HotelRoomCardProps) {
  const guests = room.occupancy.adults + (room.occupancy.childAges?.length ?? 0);

  return (
    <article
      data-selected={selected}
      className="rounded-3xl border border-foreground/10 bg-card p-5 data-[selected=true]:border-gold sm:flex sm:items-stretch sm:gap-6"
    >
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-xl leading-tight">{room.roomName}</h3>

        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {room.bedType && (
            <span className="flex items-center gap-1.5">
              <BedDouble className="size-3.5" aria-hidden="true" />
              {room.bedType}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden="true" />
            Sleeps {guests} · {room.roomCount} room{room.roomCount > 1 ? "s" : ""}
          </span>
          {room.mealPlan && (
            <span className="flex items-center gap-1.5">
              <Utensils className="size-3.5" aria-hidden="true" />
              {room.mealPlan}
            </span>
          )}
        </div>

        {room.inclusions && room.inclusions.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {room.inclusions.map((inclusion) => (
              <li key={inclusion} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 size-3.5 shrink-0 text-gold" aria-hidden="true" />
                {inclusion}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <CancellationLine room={room} />
        </div>
      </div>

      <div className="mt-5 shrink-0 border-t border-foreground/10 pt-4 sm:mt-0 sm:w-52 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
        <p className="font-display text-3xl leading-none">
          {formatMoney(room.totalPrice.amount, room.totalPrice.currency)}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          for {nights} night{nights > 1 ? "s" : ""}
          {room.roomCount > 1 ? `, ${room.roomCount} rooms` : ""}
        </p>
        <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
          {room.basePrice && (
            <div className="flex justify-between gap-3 sm:justify-end sm:gap-2">
              <dt>Room charges</dt>
              <dd>{formatMoney(room.basePrice.amount, room.basePrice.currency)}</dd>
            </div>
          )}
          {room.taxes && (
            <div className="flex justify-between gap-3 sm:justify-end sm:gap-2">
              <dt>Taxes</dt>
              <dd>{formatMoney(room.taxes.amount, room.taxes.currency)}</dd>
            </div>
          )}
          {room.feesAndCharges && (
            <div className="flex justify-between gap-3 sm:justify-end sm:gap-2">
              <dt>Fees</dt>
              <dd>{formatMoney(room.feesAndCharges.amount, room.feesAndCharges.currency)}</dd>
            </div>
          )}
        </dl>

        {onSelect && (
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={disabled || selecting}
            onClick={() => onSelect(room)}
          >
            {selecting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Checking…
              </>
            ) : (
              "Select room"
            )}
          </Button>
        )}

        {room.roomsAvailable !== undefined && room.roomsAvailable <= 3 && (
          <p className="mt-2 text-xs text-destructive">Only {room.roomsAvailable} left at this rate</p>
        )}
        {room.paymentPolicy && <p className="mt-2 text-xs text-muted-foreground">{room.paymentPolicy}</p>}
      </div>
    </article>
  );
}
