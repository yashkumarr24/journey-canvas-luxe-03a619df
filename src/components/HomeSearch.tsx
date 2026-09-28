import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, Gift, PlaneTakeoff, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HotelSearchForm } from "@/components/booking/HotelSearchForm";
import { HotelResultCard } from "@/components/booking/HotelResultCard";
import { HotelResultsSkeleton } from "@/components/booking/HotelResultsSkeleton";
import { useMockHotels } from "@/lib/hotel-api";
import { hotelSearchQueryOptions, toHotelSearchRequest, type HotelSearchFormValues } from "@/lib/hotel-search";
import { toBookingError } from "@/lib/booking-api";
import { cabinClassOptions, defaultFlightSearchValues, flightSearchSchema, type FlightSearchFormValues } from "@/lib/flight-search";
import type { HotelSearchRequest } from "@/types/booking";
import { destinations } from "@/data/destinations";

type Service = "flights" | "hotels" | "holidays";
type FlightMode = FlightSearchFormValues["tripType"] | "multicity";
type Segment = { origin: string; destination: string; date: string };
const services = [
  { label: "Flights", value: "flights", icon: PlaneTakeoff },
  { label: "Hotels", value: "hotels", icon: BedDouble },
  { label: "Holidays", value: "holidays", icon: Gift },
] as const;
const emptySegment = (): Segment => ({ origin: "", destination: "", date: "" });
function todayISO() { return new Date().toISOString().slice(0, 10); }

export function HomeSearch() {
  const navigate = useNavigate();
  const [service, setService] = useState<Service>("flights");
  const [mode, setMode] = useState<FlightMode>("roundtrip");
  const [values, setValues] = useState<FlightSearchFormValues>(defaultFlightSearchValues);
  const [segments, setSegments] = useState<Segment[]>([emptySegment(), emptySegment()]);
  const [error, setError] = useState<string | null>(null);
  const [hotelRequest, setHotelRequest] = useState<HotelSearchRequest | null>(null);
  const hotelQuery = useQuery(hotelSearchQueryOptions(hotelRequest));
  const [holidayDestination, setHolidayDestination] = useState("");
  const [holidaySearched, setHolidaySearched] = useState(false);
  const matchingHolidays = destinations.filter((item) => `${item.name} ${item.country} ${item.region}`.toLowerCase().includes(holidayDestination.trim().toLowerCase()));
  const patch = (next: Partial<FlightSearchFormValues>) => setValues((current) => ({ ...current, ...next }));
  const submitFlight = (event: FormEvent) => {
    event.preventDefault();
    const parsed = flightSearchSchema.safeParse({ ...values, tripType: mode === "multicity" ? "oneway" : mode, returnDate: mode === "roundtrip" ? values.returnDate : "" });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your search details."); return; }
    setError(null);
    void navigate({ to: "/flights", search: parsed.data });
  };
  const submitHotel = (hotelValues: HotelSearchFormValues) => {
    setHotelRequest(toHotelSearchRequest(hotelValues));
  };
  const patchSegment = (index: number, patch: Partial<Segment>) => setSegments((current) => current.map((segment, i) => i === index ? { ...segment, ...patch } : segment));

  return (
    <div className="w-full">
      <div role="tablist" aria-label="Booking options" className="grid grid-cols-3 gap-px border border-foreground/10 bg-foreground/10">
        {services.map(({ label, value, icon: Icon }) => (
          <Button key={value} type="button" role="tab" aria-selected={service === value} aria-controls="home-search-panel" variant="ghost" onClick={() => { setService(value); setError(null); }} className={`group h-14 min-w-0 rounded-none px-2 text-xs uppercase sm:h-16 sm:gap-3 sm:text-sm ${service === value ? "border-b-2 border-gold bg-card text-foreground" : "bg-background text-muted-foreground hover:bg-card hover:text-foreground"}`}>
            <Icon className={`size-5 shrink-0 ${service === value ? "text-gold" : ""}`} aria-hidden="true" />{label}
          </Button>
        ))}
      </div>
      <div id="home-search-panel" role="tabpanel" className="border-x border-b border-foreground/10 bg-card p-4 shadow-[var(--shadow-luxe)] sm:p-6">
        {service === "flights" && (
          <div>
            <div role="group" aria-label="Flight trip type" className="mb-5 flex flex-wrap gap-1 border-b border-border pb-4">
              {([ ["roundtrip", "Return"], ["oneway", "One Way"], ["multicity", "Multi-City"] ] as const).map(([value, label]) => (
                <Button key={value} type="button" variant="ghost" aria-pressed={mode === value} onClick={() => { setMode(value); setError(null); }} className={`rounded-none px-4 text-xs sm:text-sm ${mode === value ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "text-muted-foreground"}`}>{label}</Button>
              ))}
            </div>
            {mode === "multicity" ? (
              <div className="space-y-4">
                {segments.map((segment, index) => (
                  <div key={index} className="border-b border-border pb-4">
                    <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase text-muted-foreground">Flight {index + 1}</span>{segments.length > 2 && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove flight ${index + 1}`} onClick={() => setSegments((current) => current.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button>}</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <SearchField label={`Flight ${index + 1} from`}><Input aria-label={`Flight ${index + 1} from airport code`} placeholder="AMD" maxLength={3} value={segment.origin} onChange={(event) => patchSegment(index, { origin: event.target.value.toUpperCase() })} className="uppercase" /></SearchField>
                      <SearchField label={`Flight ${index + 1} to`}><Input aria-label={`Flight ${index + 1} to airport code`} placeholder="DXB" maxLength={3} value={segment.destination} onChange={(event) => patchSegment(index, { destination: event.target.value.toUpperCase() })} className="uppercase" /></SearchField>
                      <SearchField label={`Flight ${index + 1} departure`}><Input aria-label={`Flight ${index + 1} departure date`} type="date" min={index === 0 ? todayISO() : segments[index - 1]?.date || todayISO()} value={segment.date} onChange={(event) => patchSegment(index, { date: event.target.value })} /></SearchField>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" size="sm" disabled={segments.length >= 5} onClick={() => setSegments((current) => [...current, emptySegment()])}><Plus className="size-4" />Add flight</Button><span className="text-xs text-muted-foreground">Multi-city fares are arranged by our travel desk.</span></div>
                <Button asChild className="bg-gold text-primary-foreground hover:bg-primary"><Link to="/contact">Plan a multi-city journey</Link></Button>
              </div>
            ) : (
              <form onSubmit={submitFlight} noValidate>
                <div className={`grid gap-3 md:grid-cols-2 ${mode === "roundtrip" ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
                  <SearchField label="From"><Input aria-label="From airport code" placeholder="AMD" maxLength={3} value={values.origin} onChange={(event) => patch({ origin: event.target.value.toUpperCase() })} className="uppercase" /></SearchField>
                  <SearchField label="To"><Input aria-label="To airport code" placeholder="DXB" maxLength={3} value={values.destination} onChange={(event) => patch({ destination: event.target.value.toUpperCase() })} className="uppercase" /></SearchField>
                  <SearchField label="Departure"><Input aria-label="Departure date" type="date" min={todayISO()} value={values.departureDate} onChange={(event) => patch({ departureDate: event.target.value })} /></SearchField>
                  {mode === "roundtrip" && <SearchField label="Return"><Input aria-label="Return date" type="date" min={values.departureDate || todayISO()} value={values.returnDate ?? ""} onChange={(event) => patch({ returnDate: event.target.value })} /></SearchField>}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
                  {([ ["adults", "Adults"], ["children", "Children"], ["infants", "Infants"] ] as const).map(([name, label]) => <SearchField key={name} label={label}><Input aria-label={label} type="number" min={name === "adults" ? 1 : 0} max={9} value={values[name]} onChange={(event) => patch({ [name]: Number(event.target.value) })} /></SearchField>)}
                  <SearchField label="Cabin class"><Select value={values.cabinClass} onValueChange={(value) => patch({ cabinClass: value as FlightSearchFormValues["cabinClass"] })}><SelectTrigger aria-label="Cabin class" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{cabinClassOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></SearchField>
                  <Button type="submit" size="lg" className="h-full min-h-14 bg-gold px-6 text-primary-foreground hover:bg-primary"><Search className="size-4" />Search flights</Button>
                </div>
                {error && <p role="alert" className="pt-3 text-xs font-medium text-destructive">{error}</p>}
              </form>
            )}
          </div>
        )}
        {service === "hotels" && <div className="[&_form]:border-0 [&_form]:p-0 [&_form]:shadow-none"><HotelSearchForm onSearch={submitHotel} isSearching={hotelQuery.isFetching} /></div>}
        {service === "holidays" && <form onSubmit={(event) => { event.preventDefault(); setHolidaySearched(true); }} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <SearchField label="Where would you like to go?"><Input aria-label="Holiday destination" placeholder="Kashmir, Dubai, Maldives…" value={holidayDestination} onChange={(event) => { setHolidayDestination(event.target.value); setHolidaySearched(false); }} /></SearchField>
          <Button type="submit" size="lg" className="min-h-14 bg-gold px-6 text-primary-foreground hover:bg-primary"><Search className="size-4" />Explore holidays</Button>
        </form>}
      </div>
      {service === "hotels" && hotelRequest && <div className="mt-4 space-y-3 bg-card p-4 sm:p-6" aria-live="polite">
        {useMockHotels && <p className="text-sm text-muted-foreground">Preview mode · Sample stays only; no reservation is made.</p>}
        {hotelQuery.isFetching && <HotelResultsSkeleton />}
        {hotelQuery.isError && <p role="alert" className="text-sm text-destructive">{toBookingError(hotelQuery.error).message}</p>}
        {!hotelQuery.isFetching && hotelQuery.data && <><p className="text-sm font-medium">{hotelQuery.data.results.length} stays in {hotelRequest.destination}</p>{hotelQuery.data.results.length === 0 && <p className="text-sm text-muted-foreground">No stays found for these dates. Try another destination or date.</p>}{hotelQuery.data.results.slice(0, 3).map((result) => <HotelResultCard key={result.id} result={result} nights={hotelQuery.data.nights ?? 0} roomCount={hotelRequest.rooms.length} onSelect={hotelQuery.data.searchId ? () => void navigate({ to: "/hotels/detail", search: { searchId: hotelQuery.data.searchId, hotelId: result.id } }) : undefined} />)}{hotelQuery.data.results.length > 3 && <Button asChild variant="outline"><Link to="/hotels">Explore more stays</Link></Button>}</>}
      </div>}
      {service === "holidays" && holidaySearched && <div className="mt-4 bg-card p-4 sm:p-6" aria-live="polite"><p className="mb-4 text-sm font-medium">{matchingHolidays.length ? `${matchingHolidays.length} journeys` : "No matching journeys"}</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{matchingHolidays.slice(0, 6).map((item) => <Link key={item.slug} to="/destinations/$slug" params={{ slug: item.slug }} className="group flex items-center gap-3 border border-border p-2 transition-colors hover:border-gold"><img src={item.img} alt="" className="size-16 shrink-0 object-cover" /><span className="min-w-0"><strong className="block truncate text-sm">{item.name}</strong><small className="text-muted-foreground">{item.nights}</small></span></Link>)}</div>{matchingHolidays.length === 0 && <Link to="/holidays" className="text-sm text-gold underline">Browse all holidays</Link>}</div>}
    </div>
  );
}

function SearchField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><Label className="mb-2 block text-[11px] font-semibold uppercase text-muted-foreground">{label}</Label>{children}</div>;
}
