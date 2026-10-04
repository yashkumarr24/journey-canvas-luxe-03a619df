import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cabinClassOptions } from "@/lib/flight-search";
import { GUIDED_PROMPTS, nightsBetweenDates, toIsoDate, type GuidedStep } from "@/lib/assistant/guided-steps";
import type { TravelRequirements } from "@/types/assistant";

const MAX_TRAVELLERS = 9;

export interface GuidedStepControlProps {
  step: GuidedStep;
  requirements: TravelRequirements;
  onAnswer: (step: GuidedStep, patch: TravelRequirements) => void;
}

export function GuidedStepControl({ step, requirements, onAnswer }: GuidedStepControlProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{GUIDED_PROMPTS[step]}</p>
      <StepBody key={step} step={step} requirements={requirements} onAnswer={onAnswer} />
    </div>
  );
}

function StepBody({ step, requirements, onAnswer }: GuidedStepControlProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (step === "departureDate" || step === "returnDate") {
    const min = step === "returnDate" && requirements.departureDate ? new Date(`${requirements.departureDate}T00:00:00`) : today;
    return (
      <div className="w-fit rounded-lg border border-border bg-card">
        <Calendar
          mode="single"
          defaultMonth={min}
          disabled={{ before: min }}
          onSelect={(date) => {
            if (!date) return;
            const iso = toIsoDate(date);
            if (step === "departureDate") {
              const clearReturn = requirements.returnDate && requirements.returnDate < iso;
              onAnswer(step, { departureDate: iso, ...(clearReturn ? { returnDate: undefined } : {}) });
            } else {
              const derived = requirements.products?.includes("hotels") && requirements.departureDate ? { durationNights: nightsBetweenDates(requirements.departureDate, iso) } : {};
              onAnswer(step, { returnDate: iso, ...derived });
            }
          }}
        />
      </div>
    );
  }

  if (step === "tripType") {
    return (
      <Choices
        options={[{ value: "oneway", label: "One Way" }, { value: "roundtrip", label: "Round Trip" }]}
        onPick={(value) => onAnswer(step, value === "oneway" ? { tripType: "oneway", returnDate: undefined } : { tripType: "roundtrip" })}
      />
    );
  }

  if (step === "products") {
    return (
      <Choices
        options={[{ value: "flights", label: "Flights Only" }, { value: "both", label: "Flights + Hotel" }]}
        onPick={(value) => {
          if (value === "flights") return onAnswer(step, { products: ["flights"], durationNights: undefined });
          const derived = requirements.departureDate && requirements.returnDate ? { durationNights: nightsBetweenDates(requirements.departureDate, requirements.returnDate) } : {};
          onAnswer(step, {
            products: ["flights", "hotels"],
            hotelDestination: requirements.hotelDestination ?? requirements.destinationLabel ?? requirements.destination,
            ...derived,
          });
        }}
      />
    );
  }

  if (step === "nights") return <NightsStep onDone={(nights) => onAnswer(step, { durationNights: nights })} />;
  if (step === "travellers") return <TravellersStep requirements={requirements} onDone={(patch) => onAnswer(step, patch)} />;

  return (
    <Choices
      options={cabinClassOptions.map((item) => ({ value: item.value, label: item.label }))}
      onPick={(value) => onAnswer(step, { cabinClass: value as TravelRequirements["cabinClass"] })}
    />
  );
}

function Choices({ options, onPick }: { options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button key={option.value} variant="outline" size="sm" className="font-normal" onClick={() => onPick(option.value)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-sm">{label}</p>{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus /></Button>
        <span className="w-6 text-center text-sm tabular-nums">{value}</span>
        <Button variant="outline" size="icon-sm" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus /></Button>
      </div>
    </div>
  );
}

function NightsStep({ onDone }: { onDone: (nights: number) => void }) {
  const [nights, setNights] = useState(0);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <Stepper label="Nights" value={nights} min={0} max={30} onChange={setNights} />
      <Button size="sm" className="w-full" disabled={nights < 1} onClick={() => onDone(nights)}>Continue</Button>
    </div>
  );
}

function TravellersStep({ requirements, onDone }: { requirements: TravelRequirements; onDone: (patch: TravelRequirements) => void }) {
  const [adults, setAdults] = useState(requirements.adults ?? 0);
  const [children, setChildren] = useState(requirements.children ?? 0);
  const [infants, setInfants] = useState(requirements.infants ?? 0);
  const seats = adults + children;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <Stepper label="Adults" hint="12+ years" value={adults} min={0} max={MAX_TRAVELLERS - children} onChange={(v) => { setAdults(v); if (infants > v) setInfants(v); }} />
      <Stepper label="Children" hint="2–11 years" value={children} min={0} max={MAX_TRAVELLERS - adults} onChange={setChildren} />
      <Stepper label="Infants" hint="Under 2, on lap" value={infants} min={0} max={adults} onChange={setInfants} />
      <Button size="sm" className="w-full" disabled={adults < 1 || seats > MAX_TRAVELLERS} onClick={() => onDone({ adults, children, infants })}>Continue</Button>
    </div>
  );
}
