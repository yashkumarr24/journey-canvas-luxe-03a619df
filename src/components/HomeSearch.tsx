import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Armchair, ArrowLeftRight, ArrowRight, BedDouble, Car, ChevronDown, FileText, Gift, Globe2, Loader2, MapPinned, Minus, PlaneTakeoff, Plus, Search, Ship, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HotelSearchForm } from "@/components/booking/HotelSearchForm";
import { HotelResultCard } from "@/components/booking/HotelResultCard";
import { HotelResultsSkeleton } from "@/components/booking/HotelResultsSkeleton";
import { FlightResultCard } from "@/components/booking/FlightResultCard";
import { FlightResultsSkeleton } from "@/components/booking/FlightResultsSkeleton";
import { DateRangeField } from "@/components/booking/DateRangeField";
import { PackageDestinationSearch } from "@/components/PackageDestinationSearch";
import { useMockHotels } from "@/lib/hotel-api";
import { hotelSearchQueryOptions, toHotelSearchRequest, type HotelSearchFormValues } from "@/lib/hotel-search";
import { toBookingError } from "@/lib/booking-api";
import { cabinClassOptions, defaultFlightSearchValues, flightSearchQueryOptions, flightSearchSchema, MAX_PASSENGERS, toSearchRequest, type FlightSearchFormValues } from "@/lib/flight-search";
import { combinedSearchIndex, domesticSearchIndex, internationalSearchIndex } from "@/lib/packages/destination-search";
import { domesticDestinations, internationalDestinations } from "@/data/destinations";
import { domesticPackageDestinations } from "@/data/domestic-packages";
import { internationalPackageDestinations } from "@/data/international-packages";
import type { listInternationalCatalogue } from "@/lib/packages/packages.functions";
import type { HotelSearchRequest } from "@/types/booking";

type Catalogue = Awaited<ReturnType<typeof listInternationalCatalogue>>;
type Service = "flights" | "hotels" | "holidays";
type FlightMode = FlightSearchFormValues["tripType"] | "multicity";
type Segment = { origin: string; destination: string; date: string };
const services = [
  { label: "Flights", value: "flights", icon: PlaneTakeoff },
  { label: "Hotels", value: "hotels", icon: BedDouble },
  { label: "Holidays", value: "holidays", icon: Gift },
] as const;
const enquiryServices = [
  { label: "Car Rental", icon: Car },
  { label: "Visa", icon: FileText },
  { label: "Cruise", icon: Ship },
] as const;
export const ENQUIRY_EVENT = "fnf-enquiry-service";
function openEnquiry(service: string) {
  window.dispatchEvent(new CustomEvent(ENQUIRY_EVENT, { detail: service }));
  const form = document.getElementById("contact");
  if (form) { form.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  sessionStorage.setItem(ENQUIRY_EVENT, service);
  window.location.assign("/contact#contact");
}
const emptySegment = (): Segment => ({ origin: "", destination: "", date: "" });
function todayISO() { return new Date().toISOString().slice(0, 10); }

export function HomeSearch({ catalogue }: { catalogue: Catalogue }) {
  const navigate = useNavigate();
  const [service, setService] = useState<Service>("flights");
  const [mode, setMode] = useState<FlightMode>("roundtrip");
  const [values, setValues] = useState<FlightSearchFormValues>(defaultFlightSearchValues);
  const [segments, setSegments] = useState<Segment[]>([emptySegment(), emptySegment()]);
  const [error, setError] = useState<string | null>(null);
  const [hotelValues, setHotelValues] = useState<HotelSearchFormValues | null>(null);
  const hotelRequest = useMemo<HotelSearchRequest | null>(() => hotelValues ? toHotelSearchRequest(hotelValues) : null, [hotelValues]);
  const hotelQuery = useQuery({ ...hotelSearchQueryOptions(hotelRequest), refetchOnWindowFocus: false, refetchOnReconnect: false });
  // Same request + query key as the /flights and /hotels pages, so "Explore
  // more" reuses these cached results instead of searching again.
  const [flightValues, setFlightValues] = useState<FlightSearchFormValues | null>(null);
  const flightRequest = useMemo(() => flightValues ? toSearchRequest(flightValues) : null, [flightValues]);
  const flightQuery = useQuery(flightSearchQueryOptions(flightRequest));
  const patch = (next: Partial<FlightSearchFormValues>) => setValues((current) => ({ ...current, ...next }));
  const submitFlight = (event: FormEvent) => {
    event.preventDefault();
    const parsed = flightSearchSchema.safeParse({ ...values, tripType: mode === "multicity" ? "oneway" : mode, returnDate: mode === "roundtrip" ? values.returnDate : "" });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your search details."); return; }
    setError(null);
    setFlightValues(parsed.data);
  };
  const submitHotel = (next: HotelSearchFormValues) => {
    setHotelValues(next);
  };
  const patchSegment = (index: number, patch: Partial<Segment>) => setSegments((current) => current.map((segment, i) => i === index ? { ...segment, ...patch } : segment));

  // One shared holiday search over both catalogues; per-catalogue indexes are
  // built separately, then tagged and merged for Domestic/International labels.
  const holidayItems = useMemo(
    () => combinedSearchIndex(
      domesticSearchIndex(domesticDestinations, domesticPackageDestinations),
      internationalSearchIndex(internationalDestinations, internationalPackageDestinations, catalogue),
    ),
    [catalogue],
  );

  const travellers = values.adults + values.children + values.infants;

  return (
    <div className="w-full">
      <div className="grid grid-cols-3 gap-px border border-foreground/10 bg-foreground/10 sm:grid-cols-6">
        <div role="tablist" aria-label="Booking options" className="contents">
          {services.map(({ label, value, icon: Icon }) => (
            <Button key={value} type="button" role="tab" aria-selected={service === value} aria-controls="home-search-panel" variant="ghost" onClick={() => { setService(value); setError(null); }} className={`group min-h-12 min-w-0 flex-col gap-0.5 rounded-none px-1 text-[10px] uppercase tracking-wide sm:flex-row sm:gap-1.5 sm:text-xs ${service === value ? "border-b-2 border-gold bg-card text-foreground" : "bg-background text-muted-foreground hover:bg-card hover:text-foreground"}`}>
              <Icon className={`size-4 shrink-0 ${service === value ? "text-gold" : ""}`} aria-hidden="true" />{label}
            </Button>
          ))}
        </div>
        {enquiryServices.map(({ label, icon: Icon }) => (
          <Button key={label} type="button" variant="ghost" onClick={() => openEnquiry(label)} className="min-h-12 min-w-0 flex-col gap-0.5 rounded-none bg-background px-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-card hover:text-foreground sm:flex-row sm:gap-1.5 sm:text-xs">
            <Icon className="size-4 shrink-0" aria-hidden="true" />{label}
          </Button>
        ))}
      </div>
      <div id="home-search-panel" role="tabpanel" className="border-x border-b border-foreground/10 bg-card p-4 shadow-[var(--shadow-luxe)] sm:p-5">
        {service === "flights" && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select value={mode} onValueChange={(value) => { setMode(value as FlightMode); setError(null); }}>
                <SelectTrigger aria-label="Trip type" className="h-9 w-auto gap-2 rounded-sm border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:bg-background">
                  <ArrowLeftRight className="size-4 text-gold" aria-hidden="true" /><SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="roundtrip">Return</SelectItem>
                  <SelectItem value="oneway">One-way</SelectItem>
                  <SelectItem value="multicity">Multi-city</SelectItem>
                </SelectContent>
              </Select>
              <Select value={values.cabinClass} onValueChange={(value) => patch({ cabinClass: value as FlightSearchFormValues["cabinClass"] })}>
                <SelectTrigger aria-label="Cabin class" className="h-9 w-auto gap-2 rounded-sm border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:bg-background">
                  <Armchair className="size-4 text-gold" aria-hidden="true" /><SelectValue />
                </SelectTrigger>
                <SelectContent>{cabinClassOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {mode === "multicity" ? (
              <div className="space-y-4">
                {segments.map((segment, index) => (
                  <div key={index} className="border-b border-border pb-4">
                    <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase text-muted-foreground">Flight {index + 1}</span>{segments.length > 2 && <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove flight ${index + 1}`} onClick={() => setSegments((current) => current.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button>}</div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <SearchField label={`Flight ${index + 1} from`}><Input aria-label={`Flight ${index + 1} from airport code`} placeholder="AMD" maxLength={3} value={segment.origin} onChange={(event) => patchSegment(index, { origin: event.target.value.toUpperCase() })} className="h-10 uppercase" /></SearchField>
                      <SearchField label={`Flight ${index + 1} to`}><Input aria-label={`Flight ${index + 1} to airport code`} placeholder="DXB" maxLength={3} value={segment.destination} onChange={(event) => patchSegment(index, { destination: event.target.value.toUpperCase() })} className="h-10 uppercase" /></SearchField>
                      <SearchField label={`Flight ${index + 1} departure`}><Input aria-label={`Flight ${index + 1} departure date`} type="date" min={index === 0 ? todayISO() : segments[index - 1]?.date || todayISO()} value={segment.date} onChange={(event) => patchSegment(index, { date: event.target.value })} className="h-10" /></SearchField>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" size="sm" disabled={segments.length >= 5} onClick={() => setSegments((current) => [...current, emptySegment()])}><Plus className="size-4" />Add flight</Button><span className="text-xs text-muted-foreground">Multi-city fares are arranged by our travel desk.</span></div>
                <Button asChild className="bg-gold text-primary-foreground hover:bg-primary"><Link to="/contact">Plan a multi-city journey</Link></Button>
              </div>
            ) : (
              <form onSubmit={submitFlight} noValidate>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_auto_auto] lg:items-end">
                  <SearchField label="From"><Input aria-label="From airport code" placeholder="AMD" maxLength={3} value={values.origin} onChange={(event) => patch({ origin: event.target.value.toUpperCase() })} className="h-10 uppercase" /></SearchField>
                  <SearchField label="To"><Input aria-label="To airport code" placeholder="DXB" maxLength={3} value={values.destination} onChange={(event) => patch({ destination: event.target.value.toUpperCase() })} className="h-10 uppercase" /></SearchField>
                  <div className="min-w-0">
                    <Label id="home-flight-dates" className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground">{mode === "roundtrip" ? "Departure – Return" : "Departure"}</Label>
                    <DateRangeField single={mode === "oneway"} start={values.departureDate} end={values.returnDate} labelledBy="home-flight-dates" placeholder={mode === "roundtrip" ? "Select dates" : "Select date"} onChange={(departureDate, returnDate) => patch({ departureDate, returnDate })} />
                  </div>
                  <SearchField label="Travellers">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" aria-label={`Travellers: ${values.adults} adults, ${values.children} children, ${values.infants} infants`} className="h-10 w-full min-w-0 justify-between gap-2 rounded-sm px-3 font-normal lg:w-auto lg:min-w-36">
                          <span className="flex min-w-0 items-center gap-2">
                            <Users className="size-4 shrink-0 text-gold" aria-hidden="true" />
                            <span className="truncate">{travellers} traveller{travellers > 1 ? "s" : ""}</span>
                          </span>
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
                        <p className="mb-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">Travellers</p>
                        <TravellerCounter label="Adults" hint="12+ years" value={values.adults} min={1} onChange={(next) => patch({ adults: next })} />
                        <TravellerCounter label="Children" hint="2–11 years" value={values.children} min={0} onChange={(next) => patch({ children: next })} />
                        <TravellerCounter label="Infants" hint="Under 2" value={values.infants} min={0} onChange={(next) => patch({ infants: next })} />
                      </PopoverContent>
                    </Popover>
                  </SearchField>
                  <Button type="submit" disabled={flightQuery.isFetching} className="h-10 w-full rounded-sm bg-gold px-6 text-primary-foreground hover:bg-primary sm:col-span-2 lg:col-span-1 lg:w-auto">{flightQuery.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" />}Search flights</Button>
                </div>
                {error && <p role="alert" className="pt-3 text-xs font-medium text-destructive">{error}</p>}
              </form>
            )}
          </div>
        )}
        {service === "hotels" && <HotelSearchForm compact onSearch={submitHotel} isSearching={hotelQuery.isFetching} initialValues={hotelValues ?? undefined} />}
        {service === "holidays" && <div>
          <PackageDestinationSearch items={holidayItems} className="mt-0 max-w-none" label="Search holiday destinations" placeholder="City, state or country — e.g. Goa, Switzerland" />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline" className="h-auto min-h-14 justify-start gap-3 whitespace-normal rounded-none border-border px-4 py-3 text-left hover:border-gold">
              <Link to="/domestic"><MapPinned className="size-5 shrink-0 text-gold" aria-hidden="true" /><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">Domestic Holidays</strong><span className="mt-0.5 block text-xs text-muted-foreground">India’s signature destinations</span></span><ArrowRight className="size-4 shrink-0" aria-hidden="true" /></Link>
            </Button>
            <Button asChild variant="outline" className="h-auto min-h-14 justify-start gap-3 whitespace-normal rounded-none border-border px-4 py-3 text-left hover:border-gold">
              <Link to="/international"><Globe2 className="size-5 shrink-0 text-gold" aria-hidden="true" /><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">International Holidays</strong><span className="mt-0.5 block text-xs text-muted-foreground">Escapes around the world</span></span><ArrowRight className="size-4 shrink-0" aria-hidden="true" /></Link>
            </Button>
          </div>
        </div>}
      </div>
      {service === "hotels" && hotelRequest && hotelValues && <div className="mt-4 space-y-3 bg-card p-4 sm:p-6" aria-live="polite">
        {useMockHotels && <p className="text-sm text-muted-foreground">Preview mode · Sample stays only; no reservation is made.</p>}
        {hotelQuery.isFetching && <HotelResultsSkeleton />}
        {hotelQuery.isError && <p role="alert" className="text-sm text-destructive">{toBookingError(hotelQuery.error).message}</p>}
        {hotelQuery.data?.partial && <p role="status" className="text-sm text-muted-foreground">Some stays could not be checked. Available results are shown; try again to check the rest.</p>}
        {!hotelQuery.isFetching && hotelQuery.data && <><p className="text-sm font-medium">{hotelQuery.data.results.length} stays in {hotelRequest.destination}</p>{hotelQuery.data.results.length === 0 && <p className="text-sm text-muted-foreground">No stays found for these dates. Try another destination or date.</p>}{hotelQuery.data.results.slice(0, 3).map((result) => <HotelResultCard key={result.id} result={result} nights={hotelQuery.data.nights ?? 0} roomCount={hotelRequest.rooms.length} onSelect={hotelQuery.data.searchId ? () => void navigate({ to: "/hotels/detail", search: { searchId: hotelQuery.data.searchId, hotelId: result.id } }) : undefined} />)}{hotelQuery.data.results.length > 0 && <Button asChild variant="outline"><Link to="/hotels" search={hotelValues}>Explore more stays<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>}</>}
      </div>}
      {service === "flights" && flightRequest && flightValues && <div className="mt-4 space-y-3 bg-card p-4 sm:p-6" aria-live="polite">
        {flightQuery.isFetching && <FlightResultsSkeleton />}
        {flightQuery.isError && <p role="alert" className="text-sm text-destructive">{toBookingError(flightQuery.error).message}</p>}
        {!flightQuery.isFetching && flightQuery.data && <><p className="text-sm font-medium">{flightQuery.data.results.length} flights {flightRequest.origin} → {flightRequest.destination}</p>{flightQuery.data.results.length === 0 && <p className="text-sm text-muted-foreground">No flights found for these dates. Try nearby dates or airports.</p>}{flightQuery.data.results.slice(0, 3).map((result) => <FlightResultCard key={result.id} result={result} />)}{flightQuery.data.results.length > 0 && <Button asChild variant="outline"><Link to="/flights" search={flightValues}>Explore more flights<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>}</>}
      </div>}
    </div>
  );
}

function SearchField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><Label className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground">{label}</Label>{children}</div>;
}

function TravellerCounter({ label, hint, value, min, onChange }: { label: string; hint: string; value: number; min: number; onChange: (next: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="size-8 rounded-sm" aria-label={`Remove one ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus className="size-3.5" aria-hidden="true" /></Button>
        <span className="w-6 text-center text-sm" aria-live="polite">{value}</span>
        <Button type="button" variant="outline" size="icon" className="size-8 rounded-sm" aria-label={`Add one ${label.toLowerCase()}`} disabled={value >= MAX_PASSENGERS} onClick={() => onChange(Math.min(MAX_PASSENGERS, value + 1))}><Plus className="size-3.5" aria-hidden="true" /></Button>
      </div>
    </div>
  );
}
