import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DbDestination, DbPackageCard, DbPackageDetail } from "./types";

type ImgRow = { url: string; alt: string | null; is_cover: boolean; sort_order: number };

function coverRef(imgs: ImgRow[] | undefined): string | null {
  if (!imgs?.length) return null;
  const s = [...imgs].sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort_order - b.sort_order);
  return s[0].url;
}

const CARD_SELECT =
  "id,slug,name,duration_nights,duration_days,departure_city,indicative_price_from,currency,price_basis,overview,package_images(url,alt,is_cover,sort_order)";

/** All international destinations from the imported catalogue, with their packages. */
export const listInternationalCatalogue = createServerFn({ method: "GET" }).handler(async () => {
  const { rest, signRefs } = await import("./packages.server");
  const rows = await rest<any[]>(
    `destinations?region=eq.international&select=id,slug,name,country,summary,hero_image_url,sort_order,packages(${CARD_SELECT})&order=sort_order.asc,name.asc`,
  );
  const refs = rows.flatMap((d) => [d.hero_image_url, ...d.packages.map((p: any) => coverRef(p.package_images))]).filter(Boolean);
  const signed = await signRefs(refs);
  return rows.map((d): DbDestination => {
    const packages: DbPackageCard[] = d.packages.map((p: any) => {
      const ref = coverRef(p.package_images);
      return {
        slug: p.slug,
        name: p.name,
        duration_nights: p.duration_nights,
        duration_days: p.duration_days,
        departure_city: p.departure_city,
        indicative_price_from: p.indicative_price_from,
        currency: p.currency,
        price_basis: p.price_basis,
        overview: p.overview,
        image: ref ? signed[ref] ?? null : null,
      };
    });
    const hero = (d.hero_image_url && signed[d.hero_image_url]) || packages.find((p) => p.image)?.image || null;
    return { slug: d.slug, name: d.name, country: d.country, summary: d.summary, image: hero, packages };
  });
});

export const getCataloguePackage = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }): Promise<DbPackageDetail | null> => {
    const { rest, signRefs } = await import("./packages.server");
    const rows = await rest<any[]>(
      `packages?slug=eq.${encodeURIComponent(data.slug)}&select=slug,name,package_code,duration_nights,duration_days,departure_city,travel_validity_from,travel_validity_to,indicative_price_from,currency,price_basis,meal_plan,overview,highlights,` +
        `destination:destinations(slug,name,country),` +
        `package_options(id,option_name,sort_order,indicative_price,currency,price_basis,child_price_notes,single_supplement,valid_from,valid_to,notes,package_option_hotels(city,hotel_name,star_rating,room_type,nights,meal_plan,is_similar,sort_order)),` +
        `package_itinerary_days(day_number,title,description,meals,overnight_city),` +
        `package_inclusions(kind,text,sort_order),package_images(url,alt,is_cover,sort_order),` +
        `package_flights(option_id,sector,airline,flight_no,depart_time,arrive_time,is_included,notes,sort_order),` +
        `package_notes(kind,text,sort_order),package_departures(departure_date,seats_note,price_override)`,
    );
    const p = rows[0];
    if (!p) return null;
    const imgs = [...(p.package_images as ImgRow[])].sort(
      (a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort_order - b.sort_order,
    );
    const signed = await signRefs(imgs.map((i) => i.url));
    const bySort = (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order;
    const optName = new Map<string, string>(p.package_options.map((o: any) => [o.id, o.option_name]));
    return {
      slug: p.slug,
      name: p.name,
      package_code: p.package_code,
      duration_nights: p.duration_nights,
      duration_days: p.duration_days,
      departure_city: p.departure_city,
      travel_validity_from: p.travel_validity_from,
      travel_validity_to: p.travel_validity_to,
      indicative_price_from: p.indicative_price_from,
      currency: p.currency,
      price_basis: p.price_basis,
      meal_plan: p.meal_plan,
      overview: p.overview,
      highlights: p.highlights ?? [],
      destination: p.destination,
      images: imgs.map((i) => ({ url: signed[i.url], alt: i.alt })).filter((i) => i.url),
      options: [...p.package_options].sort(bySort).map((o: any) => ({
        option_name: o.option_name,
        indicative_price: o.indicative_price,
        currency: o.currency,
        price_basis: o.price_basis,
        child_price_notes: o.child_price_notes,
        single_supplement: o.single_supplement,
        valid_from: o.valid_from,
        valid_to: o.valid_to,
        notes: o.notes,
        hotels: [...o.package_option_hotels].sort(bySort).map(({ sort_order: _s, ...h }: any) => h),
      })),
      itinerary: [...p.package_itinerary_days].sort((a: any, b: any) => a.day_number - b.day_number),
      inclusions: p.package_inclusions.filter((i: any) => i.kind === "inclusion").sort(bySort).map((i: any) => i.text),
      exclusions: p.package_inclusions.filter((i: any) => i.kind === "exclusion").sort(bySort).map((i: any) => i.text),
      flights: [...p.package_flights].sort(bySort).map(({ sort_order: _s, option_id, ...f }: any) => ({
        ...f,
        option_name: option_id ? optName.get(option_id) ?? null : null,
      })),
      notes: [...p.package_notes].sort(bySort).map((n: any) => ({ kind: n.kind, text: n.text })),
      departures: [...p.package_departures].sort((a: any, b: any) => a.departure_date.localeCompare(b.departure_date)),
    };
  });
