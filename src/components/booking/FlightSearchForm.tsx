import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, PlaneTakeoff } from "lucide-react";
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
}: {
  onSearch: (values: FlightSearchFormValues) => void;
  isSearching: boolean;
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
    defaultValues: defaultFlightSearchValues,
    mode: "onSubmit",
  });

  const tripType = watch("tripType");
  const departureDate = watch("departureDate");
  const cabinClass = watch("cabinClass");
  const roundTrip = tripType === "roundtrip";

  const fid = (name: string) => `${uid}-${name}`;

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSearch)}
      className="rounded-3xl border border-foreground/10 bg-card p-5 shadow-[var(--shadow-soft)] sm:p-7"
      aria-busy={isSearching}
    >
      {/* Trip type */}
      <fieldset className="mb-6">
        <legend className="sr-only">Trip type</legend>
        <div
          role="radiogroup"
          aria-label="Trip type"
          className="inline-flex rounded-full border border-foreground/10 bg-background p-1"
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
                className={`rounded-full px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-5 ${
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
          className="w-full rounded-full bg-gold px-8 text-primary-foreground hover:bg-gold/90 sm:w-auto"
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
