# Phase 12 Update — AI Travel Search Experience

## Goal
Turn the existing `/assistant` page into a compact, responsive AI travel-search workspace. The assistant remains the conversation and requirement-capture surface; all flight and hotel data continues to come from the existing normalized search boundaries and all selections continue into the existing review and booking routes.

## Implementation
- Replace the current page-style chat with a left-side assistant workspace on desktop and a full-screen experience on smaller devices. Add a compact/collapsible desktop state while keeping the conversation, clear Demo Mode status, suggestions, retry/reset controls, and keyboard-friendly composer.
- Build the visible conversation from the required AI Elements primitives, styled to match Fly n Feel. Assistant text stays unboxed; user messages use a high-contrast branded bubble; loading uses a clear “understanding/searching” state.
- Expand the structured trip requirements to represent whether flights, a stay, or both are requested, while preserving the existing flight requirement fields and session format.
- Improve demo parsing for combined requests such as “Ahmedabad to Mumbai tomorrow and stay for 4 days, return on the 5th day in the evening,” including follow-up changes like evening-only flights, cheaper options, and airport-area hotels. It will only update search/filter intent and never create result data.
- Redesign the summary into a compact “Trip understood” card with route, dates, traveller count, cabin, stay duration, and a Change action that returns focus to the conversation.
- Orchestrate the existing `flightSearchQueryOptions` and `hotelSearchQueryOptions` from the validated requirements. Search both when accommodation is requested, show separate progress/error/empty states, and preserve the existing mock/live behavior of each boundary.
- Add compact assistant-specific flight and hotel result cards that render only normalized response fields. Derive badges and recommendation text only from returned data.
- Keep secure handoffs unchanged: flight selection uses the existing fare revalidation call and `/flights/review`; hotel selection opens `/hotels/detail` with the existing opaque search and hotel handles.
- Retain existing Phase 12 analytics and add sanitized events for hotel search/results/selection and flight results display from the assistant.

## Technical details
- No database migration, backend provider connection, new checkout, or new booking system.
- No OpenAI, TripJack, Razorpay, or other credentials.
- No generated/stock property imagery; cards display only provider-returned image and airline logo fields.
- Phase 1–11 routes, APIs, and business logic remain unchanged.
- Per request, only lightweight static checks will be run; no browser or extensive testing.
