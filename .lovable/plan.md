# Fly n Feel Complete Visual Wireframe PDF

## Goal
Create a polished, client-ready PDF that visually explains the complete existing Fly n Feel product. It will cover every current customer and staff screen in paired desktop and mobile wireframes, while preserving the current UI, architecture, and Phase 1–12 flows exactly as documented.

## Deliverable
- One downloadable, presentation-quality PDF in `/mnt/documents`.
- Branded cover, contents, product map, visual-language overview, screen groups, flow maps, state notes, and closing implementation/status summary.
- Branded wireframe styling based on the current project: pearl-white navigation, Fly n Feel red accent, editorial typography, restrained gold/detail accents, current card language, and representative existing project imagery where useful.
- Clear enough for a non-technical client to understand what each screen does, how users move through it, and what is live, demo, protected, or pending provider connection.

## Screen coverage
1. **Shared experience** — desktop/mobile navigation, menu, footer, reusable form, card, alert, filter, loading, empty, and error patterns.
2. **Discovery website** — Home, Domestic, International, destination detail, Journal, article, About, Contact, Privacy, and Terms.
3. **Flights** — search, results and filters, review/travellers, checkout, and confirmation, including major loading/error/price-change states.
4. **Hotels** — search/results, hotel detail and rooms, review/guests, checkout, and confirmation, including Preview Mode and recovery states.
5. **AI Travel Search** — initial conversation, “Trip understood,” combined flight/hotel results workspace, selection handoffs, and mobile full-screen behavior.
6. **Authentication and customer area** — sign in, register, password recovery/reset, account overview, profile, travellers, My Bookings, booking detail, support, and guest booking lookup.
7. **Admin and operations** — login, dashboard, bookings, booking detail/timeline, support, activity, sessions, funnel, analytics, booking activity, admin users, and access-level states.
8. **End-to-end maps** — flight booking, hotel booking, assistant handoff, customer support/cancellation, guest lookup, and staff operations.

## Presentation approach
- Use a consistent landscape page system with a title, purpose statement, desktop frame, mobile frame, numbered callouts, and concise client-facing notes.
- Use readable schematic content rather than screenshots, so layouts and hierarchy remain clear at PDF scale.
- Group closely related utility/legal screens where this improves readability; each existing route will still be named and represented.
- Distinguish actual product behavior from future integrations. Demo/test notices, provider-only data, role restrictions, and request-only cancellation/refund behavior will be labelled accurately.
- Avoid exposing implementation secrets, credentials, internal-only values, or invented prices, availability, ratings, booking data, or provider content.

## Production steps
1. Use the existing wireframe specification, handover, route list, components, design tokens, and bundled brand assets as the source of truth.
2. Build a reusable PDF layout system for cover, contents, flow diagrams, desktop/mobile device frames, annotations, and status labels.
3. Draw all screen groups and responsive variants with consistent numbering and a route index for client reference.
4. Export the final versioned PDF to Files.
5. Render every PDF page to images and visually inspect all pages for clipping, overlaps, weak contrast, missing fonts/assets, inconsistent spacing, and incorrect ordering; repair and regenerate until clean.

## Scope controls
- Documentation only: no application code, routes, UI, data, migrations, integrations, or project behavior will be changed.
- No browser regression testing, builds, provider calls, or credit-heavy generation.
- Existing project information and assets will be reused; no unnecessary new imagery or speculative functionality.
