import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, MapPin, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { hotelApi } from '@/lib/hotel-api';
import { editHotelDestination, selectHotelDestination } from '@/lib/hotel-destination';
import type { HotelSearchFormValues } from '@/lib/hotel-search';
import type { HotelDestinationSuggestion } from '@/types/booking';

export function HotelDestinationAutocomplete({ id, values, onChange, invalid, compact }: {
  id: string; values: HotelSearchFormValues; onChange: (patch: Partial<HotelSearchFormValues>) => void;
  invalid?: boolean; compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [term, setTerm] = useState('');
  const normalized = values.destination.trim().replace(/\s+/g, ' ').toLowerCase();
  useEffect(() => {
    const timer = setTimeout(() => setTerm(normalized), 250);
    return () => clearTimeout(timer);
  }, [normalized]);
  const query = useQuery({ queryKey: ['hotel-destinations', term],
    queryFn: ({ signal }) => hotelApi.destinations(term, { signal, timeoutMs: 10000 }),
    enabled: open && term.length >= 2 && !values.destinationId,
    staleTime: 60000, retry: false });
  const current = term === normalized;
  const items = current ? query.data ?? [] : [];
  const expanded = open && normalized.length >= 2 && !values.destinationId;
  const loading = !current || query.isFetching;
  const status = loading ? 'Searching hotels and cities…' : query.isError ? 'Destination suggestions are temporarily unavailable. You can enter an exact city name or try again.' : items.length ? `${items.length} matching hotels and cities` : 'No matching hotels or cities';
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const choose = (item: HotelDestinationSuggestion) => {
    onChange(selectHotelDestination(item)); setOpen(false); setActive(-1); input.current?.focus();
  };
  return <Popover open={expanded} onOpenChange={setOpen}>
    <PopoverAnchor asChild>
      <div className="relative min-w-0">
        <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
          aria-controls={`${id}-list`} aria-activedescendant={expanded && active >= 0 && items[active] ? `${id}-option-${active}` : undefined}
          aria-invalid={invalid} autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={256}
          placeholder="Hotel name or city" className={`${compact ? 'h-10 ' : ''}pl-9 pr-12`}
          value={values.destination} onFocus={() => setOpen(true)}
          onChange={event => { onChange(editHotelDestination(event.target.value)); setActive(-1); setOpen(true); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true);
              if (items.length) setActive(i => event.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1));
            }
            if (event.key === 'Enter' && expanded) {
              event.preventDefault(); const item = items[active < 0 ? 0 : active]; if (item) choose(item);
            }
          }} />
        {values.destination && <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 h-full w-12" aria-label="Clear hotel destination" onClick={() => { onChange(editHotelDestination('')); setOpen(false); input.current?.focus(); }}><X className="size-4" /></Button>}
      </div>
    </PopoverAnchor>
    <span role="status" className="sr-only">{expanded ? status : ''}</span>
    <PopoverContent align="start" sideOffset={4} collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => { if (input.current?.contains(event.target as Node)) event.preventDefault(); }}
      className="z-50 w-[max(var(--radix-popover-trigger-width),20rem)] max-w-[calc(100vw-1.5rem)] p-0">
      <div ref={list} id={`${id}-list`} role="listbox" aria-label="Matching hotels and cities" data-lenis-prevent
        className="max-h-[min(18rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain">
        {!loading && items.map((item, index) => <Button type="button" key={`${item.kind}:${item.id}`} role="option"
          id={`${id}-option-${index}`} data-index={index} aria-selected={active === index} tabIndex={-1} variant="ghost"
          className={`h-auto min-h-14 w-full justify-start whitespace-normal rounded-none px-3 py-3 text-left ${active === index ? 'bg-accent text-accent-foreground' : ''}`}
          onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }} onClick={() => choose(item)}>
          {item.kind === 'hotel' ? <Building2 className="size-4 shrink-0 text-gold" /> : <MapPin className="size-4 shrink-0 text-gold" />}
          <span className="min-w-0 flex-1 break-words text-sm"><span className="font-medium">{item.kind === 'hotel' ? 'Hotel' : 'City'}: </span>{item.label}</span>
        </Button>)}
        {(loading || query.isError || !items.length) && <p className="p-4 text-sm text-muted-foreground">{status}</p>}
      </div>
    </PopoverContent>
  </Popover>;
}