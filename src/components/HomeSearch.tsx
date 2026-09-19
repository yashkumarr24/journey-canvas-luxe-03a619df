import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BedDouble, Bot, Globe2, Map, PlaneTakeoff, Search } from "lucide-react";
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
  type FlightSearchFormValues,
} from "@/lib/flight-search";

const services = [
  { label: "Flights", to: "/flights", icon: PlaneTakeoff, active: true },
  { label: "Hotels", to: "/hotels", icon: BedDouble },
  { label: "Domestic", to: "/domestic", icon: Map },
  { label: "International", to: "/international", icon: Globe2 },
] as const;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function HomeSearch() {
  const navigate = useNavigate();
  const [values, setValues] = useState<FlightSearchFormValues>(defaultFlightSearchValues);
  const [error, setError] = useState<string | null>(null);
  const roundTrip = values.tripType === "roundtrip";

  const patch = (next: Partial<FlightSearchFormValues>) =>
    setValues((current) => ({ ...current, ...next }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = flightSearchSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your search details.");
      return;
    }
    setError(null);
    void navigate({ to: "/flights", search: parsed.data });
  };

  return (
    <div className="w-full">
      <nav aria-label="Travel services" className="grid grid-cols-2 gap-px border border-foreground/10 bg-foreground/10 sm:grid-cols-4">
        {services.map(({ label, to, icon: Icon, active }) => (
          <Link
            key={label}
            to={to}
            className={`group flex min-h-20 items-center gap-3 bg-background px-4 py-4 text-left transition-colors hover:bg-card sm:flex-col sm:justify-center sm:text-center ${active ? "text-foreground" : "text-muted-foreground"}`}
          >
            <Icon className={`size-5 shrink-0 ${active ? "text-gold" : "transition-colors group-hover:text-gold"}`} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">{label}</span>
          </Link>
        ))}
      </nav>

      <form onSubmit={submit} className="border-x border-b border-foreground/10 bg-card p-3 shadow-[var(--shadow-luxe)]" noValidate>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 px-2 pb-3">
          <div className="flex gap-5">
            {(["roundtrip", "oneway"] as const).map((type) => (
              <label key={type} className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                <input
                  type="radio"
                  name="home-trip-type"
                  value={type}
                  checked={values.tripType === type}
                  onChange={() => patch({ tripType: type, returnDate: type === "oneway" ? "" : values.returnDate })}
                  className="accent-gold"
                />
                {type === "roundtrip" ? "Return" : "One way"}
              </label>
            ))}
          </div>
          <Link to="/assistant" className="inline-flex items-center gap-2 text-xs font-semibold text-gold transition-colors hover:text-foreground">
            <Bot className="size-4" aria-hidden="true" /> Ask AI instead
          </Link>
        </div>

        <div className="grid gap-px bg-foreground/10 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
          <SearchField label="From">
            <Input aria-label="From airport code" placeholder="AMD" maxLength={3} value={values.origin} onChange={(event) => patch({ origin: event.target.value.toUpperCase() })} className="border-0 bg-background uppercase shadow-none" />
          </SearchField>
          <SearchField label="To">
            <Input aria-label="To airport code" placeholder="DXB" maxLength={3} value={values.destination} onChange={(event) => patch({ destination: event.target.value.toUpperCase() })} className="border-0 bg-background uppercase shadow-none" />
          </SearchField>
          <SearchField label="Departure">
            <Input aria-label="Departure date" type="date" min={todayISO()} value={values.departureDate} onChange={(event) => patch({ departureDate: event.target.value })} className="border-0 bg-background shadow-none" />
          </SearchField>
          <SearchField label="Return">
            <Input aria-label="Return date" type="date" min={values.departureDate || todayISO()} disabled={!roundTrip} value={values.returnDate ?? ""} onChange={(event) => patch({ returnDate: event.target.value })} className="border-0 bg-background shadow-none" />
          </SearchField>
          <SearchField label="Travellers & cabin">
            <div className="grid grid-cols-[70px_1fr] gap-px bg-foreground/10">
              <Input aria-label="Adults" type="number" min={1} max={9} value={values.adults} onChange={(event) => patch({ adults: Number(event.target.value) })} className="border-0 bg-background shadow-none" />
              <Select value={values.cabinClass} onValueChange={(value) => patch({ cabinClass: value as FlightSearchFormValues["cabinClass"] })}>
                <SelectTrigger aria-label="Cabin class" className="border-0 bg-background shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>{cabinClassOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </SearchField>
          <Button type="submit" size="lg" className="h-full min-h-20 bg-gold px-8 text-primary-foreground hover:bg-primary">
            <Search className="size-4" aria-hidden="true" /> Search
          </Button>
        </div>
        {error ? <p role="alert" className="px-2 pt-3 text-xs font-medium text-destructive">{error}</p> : null}
      </form>
    </div>
  );
}

function SearchField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-background px-3 py-3">
      <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}