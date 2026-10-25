import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";

const toISO = (date?: Date) => (date ? format(date, "yyyy-MM-dd") : "");
const fromISO = (iso?: string) => (iso ? parseISO(iso) : undefined);
const short = (iso?: string) => (iso ? format(parseISO(iso), "EEE d MMM") : "");

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * One combined date control: a range (start → end) or a single date when
 * `single` is set. Values are ISO yyyy-MM-dd strings, matching the forms.
 */
export function DateRangeField({
  start,
  end,
  single = false,
  onChange,
  labelledBy,
  placeholder,
  invalid,
  minNights = 0,
}: {
  start: string;
  end?: string;
  single?: boolean;
  onChange: (start: string, end: string) => void;
  labelledBy?: string;
  placeholder: string;
  invalid?: boolean;
  minNights?: number;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const label = single
    ? short(start) || placeholder
    : start
      ? `${short(start)} – ${end ? short(end) : "…"}`
      : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-labelledby={labelledBy}
          aria-describedby={undefined}
          aria-invalid={invalid}
          className={`h-10 w-full min-w-0 justify-start gap-2 rounded-sm px-3 font-normal data-[state=open]:bg-background data-[state=open]:text-foreground ${start ? "" : "text-muted-foreground"}`}
        >
          <CalendarDays className="size-4 shrink-0 text-gold" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] overflow-x-auto p-0">
        {single ? (
          <Calendar
            mode="single"
            selected={fromISO(start)}
            defaultMonth={fromISO(start)}
            disabled={{ before: startOfToday() }}
            onSelect={(date) => {
              onChange(toISO(date), "");
              if (date) setOpen(false);
            }}
            className="pointer-events-auto p-3"
          />
        ) : (
          <Calendar
            mode="range"
            min={minNights}
            numberOfMonths={isMobile ? 1 : 2}
            selected={{ from: fromISO(start), to: fromISO(end) } as DateRange}
            defaultMonth={fromISO(start)}
            disabled={{ before: startOfToday() }}
            onSelect={(range) => {
              const from = toISO(range?.from);
              const to = range?.to && range.to.getTime() !== range.from?.getTime() ? toISO(range.to) : "";
              onChange(from, to);
              if (from && to) setOpen(false);
            }}
            className="pointer-events-auto p-3"
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
