# Project architecture rules

- Add database changes as numbered, additive migrations; catalogue lookup indexes must preserve existing sync semantics and data.
- Keep homepage search modes in the presentation layer and hand validated flight/hotel requests to existing search flows; this protects provider and booking logic from navigation redesigns.
- Hotel Book/Details/Confirm/Cancel live in backend services/hotel_booking.py with compare-and-set status transitions on hotel_bookings (0018); prevents duplicate provider bookings and keeps provider handles server-side.
- Instant hotel booking and hold confirmation are refused in production until server-side payment verification exists; they debit the TripJack wallet.
- Holiday packages (0019) are enquiry-only catalogue tables with indicative prices and no booking/payment fields; writes go through FastAPI service_role, clients read published rows only, so packages can never be booked or charged directly.
