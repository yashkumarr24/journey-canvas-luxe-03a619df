import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { PageHero } from '@/components/PageHero';
import { Button } from '@/components/ui/button';
import { internationalImage, internationalPrice, type InternationalPackage, type SourceTable } from '@/data/international-packages';

function Heading({ children }: { children: React.ReactNode }) {
  return <><h2 className="font-display text-3xl md:text-5xl">{children}</h2><div className="hairline mt-6" /></>;
}
function Lines({ items }: { items: string[] }) {
  return <ul className="mt-5 space-y-3 text-sm text-foreground/85">{items.map((t,i) => <li key={i} className="flex gap-3 whitespace-pre-line"><span className="mt-2 size-1 shrink-0 rounded-full bg-gold" />{t}</li>)}</ul>;
}
function SourceTableView({ table }: { table: SourceTable }) {
  return <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground"><tr className="border-b border-foreground/10">{table.columns.map((c,i) => <th key={i} className="py-3 pr-4 font-normal">{c}</th>)}</tr></thead><tbody>{table.rows.map((r,i) => <tr key={i} className="border-b border-foreground/10 align-top">{r.map((c,j) => <td key={j} className="whitespace-pre-line py-3 pr-4 text-foreground/85">{c}</td>)}</tr>)}</tbody></table></div>;
}
export function InternationalPackageDetails({ p, destination }: { p: InternationalPackage; destination: string }) {
  const [selection, setSelection] = useState(0);
  const opt = p.options[selection] ?? p.options[0];
  return <main className="relative bg-background text-foreground"><Nav /><PageHero image={internationalImage(p)} eyebrow={p.countries.join(' · ')} title={<>{p.name}<br /><span className="italic gold-gradient">{p.duration}</span></>} height="80svh" lightText />
    <section className="mx-auto max-w-6xl px-6 py-20"><div className="grid gap-12 lg:grid-cols-3"><div className="space-y-12 lg:col-span-2">
      <div><Heading>Tour Details</Heading><dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">{p.tour.map((f,i) => <div key={i} className="border-b border-foreground/10 pb-4"><dt className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{f.label}</dt><dd className="mt-2 whitespace-pre-line">{f.value}</dd></div>)}<div><dt className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Package Price</dt><dd className="mt-2 text-gold">{internationalPrice(p,selection)}</dd></div></dl>{p.flights.length > 0 && <><h3 className="mt-8 font-display text-2xl">Flight Details</h3>{p.flights.map((t,i) => <SourceTableView key={i} table={t} />)}</>}</div>
      <div><Heading>Hotel Details</Heading>{p.options.length > 1 && <div role="tablist" aria-label="Package options" className="mt-6 flex flex-wrap gap-2">{p.options.map((o,i) => <Button key={i} role="tab" aria-selected={i===selection} variant={i===selection ? 'default' : 'outline'} onClick={() => setSelection(i)}>Option {i+1}</Button>)}</div>}{opt && <div className="mt-6"><h3 className="font-display text-2xl">{opt.name}</h3><Lines items={opt.price.length ? opt.price : ['On request']} />{opt.tables.map((t,i) => <SourceTableView key={i} table={t} />)}{opt.details && <Lines items={opt.details} />}</div>}</div>
      <div><Heading>Day-Wise Itinerary</Heading><div className="mt-8 space-y-8">{p.itinerary.map((day,i) => <div key={i} className="border-b border-foreground/10 pb-6"><div className="text-xs uppercase tracking-[0.2em] text-gold">{day.day}{day.date && ` · ${day.date}`}</div><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{day.text}</p>{day.meals && <p className="mt-3 text-sm">Meals: {day.meals}</p>}{day.remark && <p className="mt-3 text-sm">Remark: {day.remark}</p>}</div>)}</div></div>
      <div><Heading>Inclusions</Heading><Lines items={p.inclusions} /></div><div><Heading>Exclusions</Heading>{p.exclusions.length ? <Lines items={p.exclusions} /> : <p className="mt-5 text-sm text-muted-foreground">Not specified in the source quotation.</p>}</div><div><Heading>Important Notes</Heading>{p.notes.map((g,i) => <div key={i} className="mt-6"><h3 className="font-display text-xl text-gold">{g.title}</h3><Lines items={g.items} /></div>)}<p className="mt-6 break-words text-xs text-muted-foreground">Source: {p.source}</p></div>
    </div><aside className="space-y-6 lg:sticky lg:top-28 lg:self-start"><div className="rounded-3xl border border-gold/30 bg-card p-7 shadow-[var(--shadow-luxe)]"><div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{p.options.length>1 ? `Price · Option ${selection+1}` : 'Price'}</div><div className="mt-2 font-display text-2xl text-gold">{internationalPrice(p,selection)}</div><p className="mt-3 text-xs text-muted-foreground">Indicative price, subject to availability.</p><Button asChild className="mt-6 w-full"><Link to="/contact">Enquire for a quote →</Link></Button></div><Link to="/international-packages/$destination" params={{ destination }} className="block text-center text-xs uppercase tracking-[0.25em] text-gold">More packages →</Link></aside></div></section><Footer /></main>;
}
