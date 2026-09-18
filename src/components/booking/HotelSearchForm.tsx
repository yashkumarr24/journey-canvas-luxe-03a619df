import { useId, useState } from "react";
import { Loader2, MapPin, Minus, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  currencyOptions,
  defaultHotelSearchValues,
  hotelSearchSchema,
  MAX_ADULTS_PER_ROOM,
  MAX_CHILDREN_PER_ROOM,
  MAX_CHILD_AGE,
  MAX_ROOMS,
  blankRoom,
  nationalityOptions,
  nightsBetween,
  occupancyLabel,
  type HotelSearchFormValues,
} from "@/lib/hotel-search";

/**
 * Hotel search form.
 *
 * The validation here is a courtesy to the customer, not a security control:
 * the backend re-validates every field and owns the price. Nothing about a
 * provider is referenced.
 */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowISO(from?: string): string {
  const base = from ? new Date(`${from}T00:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

export interface HotelSearchFormProps {
  onSearch: (values: HotelSearchFormValues) => void;
  isSearching: boolean;
  initialValues?: HotelSearchFormValues;
}

export function HotelSearchForm({ onSearch, isSearching, initialValues }: HotelSearchFormProps) {
  const uid = useId();
  const [values, setValues] = useState<HotelSearchFormValues>(initialValues ?? defaultHotelSearchValues);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fid = (name: string) => `${uid}-${name}`;
  const nights = nightsBetween(values.checkIn, values.checkOut);

  const patch = (next: Partial<HotelSearchFormValues>) => setValues((current) => ({ ...current, ...next }));

  const patchRoom = (index: number, next: Partial<HotelSearchFormValues["rooms"][number]>) =>
    setValues((current) => ({
      ...current,
      rooms: current.rooms.map((room, i) => (i === index ? { ...room, ...next } : room)),
    }));

  const addRoom = () =>
    setValues((current) =>
      current.rooms.length >= MAX_ROOMS ? current : { ...current, rooms: [...current.rooms, blankRoom()] },
    );

  const removeRoom = (index: number) =>
    setValues((current) =>
      current.rooms.length <= 1
        ? current
        : { ...current, rooms: current.rooms.filter((_, i) => i !== index) },
    );

  const setChildren = (index: number, count: number) =>
    setValues((current) => ({
      ...current,
      rooms: current.rooms.map((room, i) => {
        if (i !== index) return room;
        const ages = [...room.childAges];
        while (ages.length < count) ages.push(6);
        return { ...room, childAges: ages.slice(0, count) };
      }),
    }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = hotelSearchSchema.safeParse(values);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!found[key]) found[key] = issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    onSearch(parsed.data);
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-busy={isSearching}
      className="rounded-3xl border border-foreground/10 bg-card p-5 shadow-[var(--shadow-soft)] sm:p-7"
    >
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Label htmlFor={fid("destination")}>Destination</Label>
          <div className="relative mt-1.5">
            <MapPin
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={fid("destination")}
              className="pl-9"
              placeholder="Goa, Dubai, Maldives…"
              autoComplete="off"
              maxLength={80}
              value={values.destination}
              aria-invalid={!!errors.destination}
              onChange={(event) => patch({ destination: event.target.value })}
            />
          </div>
          <FieldError message={errors.destination} />
        </div>

        <div>
          <Label htmlFor={fid("checkIn")}>Check-in</Label>
          <Input
            id={fid("checkIn")}
            type="date"
            className="mt-1.5"
            min={todayISO()}
            value={values.checkIn}
            aria-invalid={!!errors.checkIn}
            onChange={(event) => {
              const checkIn = event.target.value;
              patch({
                checkIn,
                checkOut: values.checkOut && values.checkOut > checkIn ? values.checkOut : tomorrowISO(checkIn),
              });
            }}
          />
          <FieldError message={errors.checkIn} />
        </div>

        <div>
          <Label htmlFor={fid("checkOut")}>Check-out</Label>
          <Input
            id={fid("checkOut")}
            type="date"
            className="mt-1.5"
            min={tomorrowISO(values.checkIn || todayISO())}
            value={values.checkOut}
            aria-invalid={!!errors.checkOut}
            onChange={(event) => patch({ checkOut: event.target.value })}
          />
          <FieldError message={errors.checkOut} />
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Rooms & guests</legend>

        <div className="mt-4 space-y-4">
          {values.rooms.map((room, index) => (
            <div
              key={index}
              className="rounded-2xl border border-foreground/10 p-4 sm:flex sm:flex-wrap sm:items-end sm:gap-6"
            >
              <p className="text-sm font-medium sm:w-20">Room {index + 1}</p>

              <Counter
                label="Adults"
                hint="18+ years"
                value={room.adults}
                min={1}
                max={MAX_ADULTS_PER_ROOM}
                onChange={(next) => patchRoom(index, { adults: next })}
              />

              <Counter
                label="Children"
                hint={`Under ${MAX_CHILD_AGE + 1}`}
                value={room.childAges.length}
                min={0}
                max={MAX_CHILDREN_PER_ROOM}
                onChange={(next) => setChildren(index, next)}
              />

              {room.childAges.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-3 sm:mt-0">
                  {room.childAges.map((age, childIndex) => (
                    <div key={childIndex}>
                      <Label htmlFor={fid(`age-${index}-${childIndex}`)} className="text-xs">
                        Child {childIndex + 1} age
                      </Label>
                      <Input
                        id={fid(`age-${index}-${childIndex}`)}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_CHILD_AGE}
                        className="mt-1 w-20"
                        value={age}
                        onChange={(event) =>
                          patchRoom(index, {
                            childAges: room.childAges.map((current, i) =>
                              i === childIndex ? Number(event.target.value || 0) : current,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {values.rooms.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-4 sm:ml-auto sm:mt-0"
                  onClick={() => removeRoom(index)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove room
                </Button>
              )}
            </div>
          ))}
        </div>

        {values.rooms.length < MAX_ROOMS && (
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={addRoom}>
            <Plus className="size-4" aria-hidden="true" />
            Add another room
          </Button>
        )}
        <FieldError message={errors.rooms} />
      </fieldset>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={fid("nationality")}>Guest nationality</Label>
          <Select value={values.nationality} onValueChange={(value) => patch({ nationality: value })}>
            <SelectTrigger id={fid("nationality")} className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {nationalityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">Affects rates and local taxes.</p>
        </div>

        <div>
          <Label htmlFor={fid("currency")}>Currency</Label>
          <Select value={values.currency} onValueChange={(value) => patch({ currency: value })}>
            <SelectTrigger id={fid("currency")} className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-2 sm:flex sm:items-end sm:justify-end">
          <div className="text-sm text-muted-foreground sm:mr-6 sm:text-right">
            <p>{occupancyLabel(values.rooms)}</p>
            <p className="mt-1">{nights > 0 ? `${nights} night${nights > 1 ? "s" : ""}` : "Pick your dates"}</p>
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={isSearching}
            className="mt-4 w-full rounded-full bg-gold px-8 text-primary-foreground hover:bg-gold/90 sm:mt-0 sm:w-auto"
          >
            {isSearching ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Searching…
              </>
            ) : (
              <>
                <Search className="size-4" aria-hidden="true" />
                Search hotels
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
      <span aria-hidden="true">⚠ </span>
      {message}
    </p>
  );
}

function Counter({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="mt-4 sm:mt-0">
      <p className="text-xs text-muted-foreground">
        {label} <span className="opacity-70">· {hint}</span>
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 rounded-full"
          aria-label={`Remove one ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </Button>
        <span className="w-6 text-center text-sm" aria-live="polite">
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 rounded-full"
          aria-label={`Add one ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
