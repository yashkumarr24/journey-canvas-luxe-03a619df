# Holiday Packages — Proposed Schema and Migration Plan

Proposal only. No data import, no changes to the current destination pages.

## Hierarchy

```text
destinations ──< packages ──< package_options ──< package_option_hotels
                    │
                    ├──< package_itinerary_days
                    ├──< package_inclusions   (kind: inclusion | exclusion)
                    ├──< package_images
                    ├──< package_flights      (optional)
                    ├──< package_notes        (visa | gst | payment | cancellation | other)
                    ├──< package_departures   (travel dates, optional)
                    └──< package_enquiries
package_sources (one row per DOCX file) ──< packages
```

## Tables (migration `0019_holiday_packages.sql`)

**destinations**: id, slug (unique), name, country, region (`domestic` | `international`), state_or_area, hero_image_url, summary, sort_order, is_published, timestamps. The current static slugs (kashmir, dubai, etc.) keep their names, so the existing pages can be moved over later without breaking links.

**package_sources**: id, original_filename (unique), file_checksum (sha256), parsed_at, parse_status (`pending` | `parsed` | `needs_review` | `failed`), parse_warnings jsonb. This records where every package came from and makes re-imports safe to run again.

**packages**: id, destination_id, source_id, package_code (unique, nullable), name, slug (unique), duration_nights, duration_days, departure_city, travel_validity_from/to (nullable), indicative_price_from numeric(12,2), currency char(3) default `INR`, price_basis (e.g. "per person, twin sharing"), meal_plan, overview, highlights text[], is_published (default false), timestamps.

**package_options**: id, package_id, option_name (Standard / Deluxe / Luxury, or as written in the source), sort_order, indicative_price numeric(12,2), currency, price_basis, child_price_notes, single_supplement, valid_from/to, notes.

**package_option_hotels**: id, option_id, city, hotel_name, star_rating smallint (nullable), room_type, nights smallint, meal_plan, is_similar boolean (for "or similar"), sort_order.

**package_itinerary_days**: id, package_id, day_number, title, description, meals text[], overnight_city; unique (package_id, day_number).

**package_inclusions**: id, package_id, kind (`inclusion` | `exclusion`), text, sort_order.

**package_images**: id, package_id, url, alt, is_cover, sort_order.

**package_flights** (only when the source mentions flights): id, package_id, option_id (nullable), sector, airline, flight_no, depart_time, arrive_time, is_included boolean, notes.

**package_notes**: id, package_id, kind (`visa` | `gst` | `tcs` | `payment` | `cancellation` | `other`), text, sort_order.

**package_departures**: id, package_id, departure_date, seats_note, price_override numeric(12,2) (nullable).

**package_enquiries**: id, package_id, option_id (nullable), user_id (nullable), name, email, phone, travel_month, adults, children, message, status (`new` | `contacted` | `quoted` | `closed`), source (`web` | `whatsapp`), created_at.

All money uses `numeric(12,2)` plus a currency, with checks that prices are 0 or more. Every option, hotel and price is labelled **indicative**. There is no booking status, payment link or provider ID anywhere in these tables.

## Access rules (RLS + grants in the same migration)

- Content tables: `anon` and `authenticated` can only SELECT rows where the parent package `is_published = true`. Writes are only possible through FastAPI using the service-role key.
- `package_sources`: no access from the browser.
- `package_enquiries`: `anon` and `authenticated` can INSERT through FastAPI, which validates and rate-limits the request. Users can read only their own rows (`user_id = auth.uid()`). Staff handle enquiries through the existing admin/ops layer.
- Indexes on: destination_id, packages.slug, package_code, foreign keys, and (is_published, region).

## Migration plan

1. `0019_holiday_packages.sql`: create all tables, grants, RLS, indexes and `updated_at` triggers. This is additive and does not touch any existing table.
2. `0020_seed_destinations.sql` (optional): add destination rows for the current static slugs.
3. Importer (a later phase, not now): a FastAPI CLI that parses each DOCX into `package_sources` → `packages` and child tables. It is idempotent by checksum, imports packages unpublished, and marks anything ambiguous as `needs_review`. It is dry-run by default.
4. Package UI (a later phase): listing → package detail (options tab, hotel table per option, itinerary, inclusions/exclusions, flights, notes) → enquiry form. Every price shows an "Indicative, subject to availability" label. The main button is "Enquire", never "Book".
5. Switch the existing destination pages over to read from the database, only after you approve.

## Open questions

- Do some DOCX files describe the same package in several variants (e.g. separate Deluxe and Luxury files)? If so, the importer will merge them into one package with multiple options.
- Should enquiries also notify by email or WhatsApp through the existing notification service?
