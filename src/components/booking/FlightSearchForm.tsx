import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Armchair, ArrowLeftRight, ChevronDown, Loader2, MapPin, PlaneTakeoff, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRangeField } from "@/components/booking/DateRangeField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cabinClassOptions,
  defaultFlightSearchValues,
  flightSearchSchema,
  MAX_PASSENGERS,
  type FlightSearchFormValues,
} from "@/lib/flight-search";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs font-medium text-destructive">
      <span aria-hidden="true">⚠ </span>
      {message}
    </p>
  );
}

export function FlightSearchForm({
  onSearch,
  isSearching,
  initialValues,
  compact = false,
}: {
  onSearch: (values: FlightSearchFormValues) => void;
  isSearching: boolean;
  initialValues?: FlightSearchFormValues;
  compact?: boolean;
}) {
  const uid = useId();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FlightSearchFormValues>({
    resolver: zodResolver(flightSearchSchema),
    defaultValues: initialValues ?? defaultFlightSearchValues,
    mode: "onSubmit",
  });

  const tripType = watch("tripType");
  const departureDate = watch("departureDate");
  const cabinClass = watch("cabinClass");
  const returnDate = watch("returnDate");
  const travellers = watch("adults") + watch("children") + watch("infants");
  const roundTrip = tripType === "roundtrip";

  const fid = (name: string) => `${uid}-${name}`;

  if (compact) {
    return (
      <form noValidate onSubmit={handleSubmit(onSearch)} aria-busy={isSearching}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={tripType} onValueChange={(value) => setValue("tripType", value as FlightSearchFormValues["tripType"])}>
            <SelectTrigger aria-label="Trip type" className="h-10 w-auto gap-2 border-transparent bg-transparent px-2 shadow-none">
              <ArrowLeftRight className="size-4 text-gold" aria-hidden="true" /><SelectValue />
            </SelectTrigger>
            <SelectContent><SelectItem value="roundtrip">Return</SelectItem><SelectItem value="oneway">One-way</SelectItem></SelectContent>
          </Select>
          <Select value={cabinClass} onValueChange={(value) => setValue("cabinClass", value as FlightSearchFormValues["cabinClass"])}>
            <SelectTrigger aria-label="Cabin class" className="h-10 w-auto gap-2 border-transparent bg-transparent px-2 shadow-none">
              <Armchair className="size-4 text-gold" aria-hidden="true" /><SelectValue />
            </SelectTrigger>
            <SelectContent>{cabinClassOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_1fr_auto] lg:items-start">
          {([{ name: "origin", label: "From", placeholder: "AMD" }, { name: "destination", label: "To", placeholder: "DXB" }] as const).map((field) => (
            <div key={field.name} className="min-w-0">
              <Label htmlFor={fid(field.name)} className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground">{field.label}</Label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gold" aria-hidden="true" />
                <Input id={fid(field.name)} placeholder={field.placeholder} maxLength={3} autoComplete="off" className="h-10 pl-9 uppercase" aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? fid(`${field.name}-error`) : undefined} {...register(field.name)} />
              </div>
              <FieldError id={fid(`${field.name}-error`)} message={errors[field.name]?.message} />
            </div>
          ))}
          <div className="min-w-0">
            <Label id={fid("dates-label")} className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground">{roundTrip ? "Departure – Return" : "Departure"}</Label>
            <DateRangeField single={!roundTrip} start={departureDate} end={returnDate} labelledBy={fid("dates-label")} placeholder={roundTrip ? "Select dates" : "Select date"} invalid={!!(errors.departureDate || errors.returnDate)} onChange={(start, end) => { setValue("departureDate", start); setValue("returnDate", end); }} />
            <FieldError id={fid("dates-error")} message={errors.departureDate?.message ?? errors.returnDate?.message} />
          </div>
          <div className="min-w-0">
            <Label id={fid("travellers-label")} className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground">Travellers</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" aria-labelledby={fid("travellers-label")} className="h-10 w-full min-w-0 justify-between gap-2 rounded-sm px-3 font-normal">
                  <Users className="size-4 shrink-0 text-gold" aria-hidden="true" /><span className="min-w-0 truncate">{travellers} traveller{travellers === 1 ? "" : "s"}</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-[60svh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto">
                <div className="space-y-4">
                  {([{ name: "adults", label: "Adults", hint: "12+ years", min: 1 }, { name: "children", label: "Children", hint: "2–11 years", min: 0 }, { name: "infants", label: "Infants", hint: "Under 2", min: 0 }] as const).map((field) => (
                    <div key={field.name} className="flex items-center justify-between gap-3">
                      <div><Label htmlFor={fid(field.name)}>{field.label}</Label><p className="text-xs text-muted-foreground">{field.hint}</p></div>
                      <Input id={fid(field.name)} type="number" inputMode="numeric" min={field.min} max={MAX_PASSENGERS} className="h-10 w-20" {...register(field.name, { valueAsNumber: true })} />
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {(["adults", "children", "infants"] as const).map((name) => <FieldError key={name} id={fid(`${name}-error`)} message={errors[name]?.message} />)}
          </div>
          <Button type="submit" disabled={isSearching} className="h-10 w-full rounded-sm bg-gold px-6 text-primary-foreground hover:bg-primary sm:col-span-2 lg:col-span-1 lg:mt-[22px] lg:w-auto">
            {isSearching ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PlaneTakeoff className="size-4" aria-hidden="true" />}{isSearching ? "Searching…" : "Search flights"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSearch)}
      className="rounded-sm border border-foreground/10 bg-card p-5 shadow-[var(--shadow-soft)] sm:p-7"
      aria-busy={isSearching}
    >
      {/* Trip type */}
      <fieldset className="mb-6">
        <legend className="sr-only">Trip type</legend>
        <div
          role="radiogroup"
          aria-label="Trip type"
          className="inline-flex rounded-sm border border-foreground/10 bg-background p-1"
        >
          {(
            [
              { value: "roundtrip", label: "Round Trip" },
              { value: "oneway", label: "One Way" },
            ] as const
          ).map((option) => {
            const active = tripType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setValue("tripType", option.value, { shouldValidate: false })}
                className={`rounded-sm px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-5 ${
                  active
                    ? "bg-gold text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor={fid("origin")}>From</Label>
          <Input
            id={fid("origin")}
            placeholder="AMD"
            autoComplete="off"
            maxLength={3}
            className="mt-1.5 uppercase"
            aria-invalid={!!errors.origin}
            aria-describedby={errors.origin ? fid("origin-error") : undefined}
            {...register("origin")}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Airport code, e.g. AMD</p>
          <FieldError id={fid("origin-error")} message={errors.origin?.message} />
        </div>

        <div>
          <Label htmlFor={fid("destination")}>To</Label>
          <Input
            id={fid("destination")}
            placeholder="DXB"
            autoComplete="off"
            maxLength={3}
            className="mt-1.5 uppercase"
            aria-invalid={!!errors.destination}
            aria-describedby={errors.destination ? fid("destination-error") : undefined}
            {...register("destination")}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">Airport code, e.g. DXB</p>
          <FieldError id={fid("destination-error")} message={errors.destination?.message} />
        </div>

        <div>
          <Label htmlFor={fid("departureDate")}>Departure</Label>
          <Input
            id={fid("departureDate")}
            type="date"
            min={todayISO()}
            className="mt-1.5"
            aria-invalid={!!errors.departureDate}
            aria-describedby={errors.departureDate ? fid("departureDate-error") : undefined}
            {...register("departureDate")}
          />
          <FieldError id={fid("departureDate-error")} message={errors.departureDate?.message} />
        </div>

        <div>
          <Label htmlFor={fid("returnDate")}>
            Return{!roundTrip && <span className="text-muted-foreground"> (round trip only)</span>}
          </Label>
          <Input
            id={fid("returnDate")}
            type="date"
            min={departureDate || todayISO()}
            disabled={!roundTrip}
            className="mt-1.5"
            aria-invalid={!!errors.returnDate}
            aria-describedby={errors.returnDate ? fid("returnDate-error") : undefined}
            {...register("returnDate")}
          />
          <FieldError id={fid("returnDate-error")} message={errors.returnDate?.message} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            { name: "adults", label: "Adults", hint: "12+ years", min: 1 },
            { name: "children", label: "Children", hint: "2–11 years", min: 0 },
            { name: "infants", label: "Infants", hint: "Under 2", min: 0 },
          ] as const
        ).map((field) => (
          <div key={field.name}>
            <Label htmlFor={fid(field.name)}>{field.label}</Label>
            <Input
              id={fid(field.name)}
              type="number"
              inputMode="numeric"
              min={field.min}
              max={MAX_PASSENGERS}
              className="mt-1.5"
              aria-invalid={!!errors[field.name]}
              aria-describedby={errors[field.name] ? fid(`${field.name}-error`) : undefined}
              {...register(field.name, { valueAsNumber: true })}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{field.hint}</p>
            <FieldError id={fid(`${field.name}-error`)} message={errors[field.name]?.message} />
          </div>
        ))}

        <div>
          <Label htmlFor={fid("cabinClass")}>Cabin class</Label>
          <Select
            value={cabinClass}
            onValueChange={(value) =>
              setValue("cabinClass", value as FlightSearchFormValues["cabinClass"])
            }
          >
            <SelectTrigger id={fid("cabinClass")} className="mt-1.5 w-full">
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {cabinClassOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          We quote from your departure city with the best mix of fares available.
        </p>
        <Button
          type="submit"
          size="lg"
          disabled={isSearching}
          className="w-full rounded-sm bg-gold px-8 text-primary-foreground hover:bg-primary sm:w-auto"
        >
          {isSearching ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Searching…
            </>
          ) : (
            <>
              <PlaneTakeoff className="size-4" aria-hidden="true" />
              Search flights
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
