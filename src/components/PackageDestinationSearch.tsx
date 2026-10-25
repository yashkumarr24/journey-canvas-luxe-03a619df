import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Search, X, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { matchDestinations, type DestinationSuggestion } from '@/lib/packages/destination-search';

export function PackageDestinationSearch({ items, className = 'mt-10 max-w-2xl', label = 'Search destinations', placeholder = 'Country, city or state / region' }: { items: DestinationSuggestion[]; className?: string; label?: string; placeholder?: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [room, setRoom] = useState(280);
  const navigate = useNavigate();
  const results = matchDestinations(items, text);
  const expanded = open && Boolean(text.trim());

  useEffect(() => {
    if (!expanded) return;
    const viewport = window.visualViewport;
    const resize = () => {
      const bottom = input.current?.getBoundingClientRect().bottom ?? 0;
      setRoom(Math.max(96, Math.min(320, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - bottom - 16)));
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('scroll', resize, { passive: true });
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); window.removeEventListener('scroll', resize); };
  }, [expanded]);

  useEffect(() => {
    if (active >= 0) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(item: DestinationSuggestion) {
    setOpen(false);
    input.current?.blur();
    // Preserve the existing route families, with a validated place parameter only
    // for static international country groups.
    if (item.target.to === '/international-packages/$destination') {
      void navigate({ ...item.target, search: item.target.search ?? {} });
    } else {
      void navigate(item.target);
    }
  }
  function clear() { setText(''); setActive(-1); setOpen(false); input.current?.focus(); }

  return <div className={`relative z-20 w-full ${className}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id} className="mb-3 block text-sm font-medium text-foreground">{label}</label>
    <div className="flex min-h-14 items-center gap-2 rounded-sm border border-input bg-card px-3 focus-within:ring-1 focus-within:ring-ring">
      <Search aria-hidden="true" className="pointer-events-none size-5 shrink-0 text-gold" />
      <Input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`} aria-activedescendant={expanded && active >= 0 && results[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={placeholder} value={text}
        className="min-h-14 min-w-0 flex-1 border-0 px-1 text-base shadow-none focus-visible:ring-0 md:text-base" onFocus={() => setOpen(true)}
        onChange={event => { setText(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (results.length) setActive(i => event.key === 'ArrowDown' ? (i + 1) % results.length : (i <= 0 ? results.length - 1 : i - 1));
          }
          if (event.key === 'Enter' && expanded && results.length) { event.preventDefault(); choose(results[active < 0 ? 0 : active]); }
        }} />
      {text && <Button type="button" variant="ghost" size="icon" className="size-12 shrink-0 text-muted-foreground" aria-label="Clear destination search" title="Clear search" onClick={clear}><X /></Button>}
    </div>
    <span role="status" aria-live="polite" className="sr-only">{expanded ? results.length ? `${results.length} matching destinations` : 'No matching destinations' : ''}</span>
    {expanded && <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-sm border border-input bg-card shadow-[var(--shadow-card)]">
      <div id={`${id}-list`} ref={list} role="listbox" aria-label="Matching destinations" data-lenis-prevent className="overflow-y-auto overscroll-contain" style={{ maxHeight: room }}>
        {results.map((item, index) => <Button key={`${item.name}|${item.location}`} id={`${id}-option-${index}`} role="option" aria-selected={active === index} tabIndex={-1} data-index={index}
          variant="ghost" className={`min-h-14 w-full justify-start rounded-none px-4 py-3 text-left ${active === index ? 'bg-accent text-accent-foreground' : ''}`}
          onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }} onClick={() => choose(item)}>
          <MapPin aria-hidden="true" className="text-gold" /><span className="min-w-0 flex-1"><span className="block">{item.name}{item.location !== 'International' && `, ${item.location}`}</span><span className="block text-xs text-muted-foreground">{item.kind}</span></span>
          {item.catalogue && <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${item.catalogue === 'Domestic' ? 'border-gold/40 text-gold' : 'border-foreground/20 text-muted-foreground'}`}>{item.catalogue}</span>}
        </Button>)}
      </div>
      {!results.length && <p className="p-4 text-sm text-muted-foreground">No matching destinations</p>}
    </div>}
  </div>;
}