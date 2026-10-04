# Header AI side-by-side results

## Build
- Extract the assistant’s validated flight/hotel search state, API queries, sorting, analytics, and selection handoff into one shared hook.
- Extract the existing real flight and hotel result sections into a reusable results view.
- Change Header ASK AI into a full workspace: the existing conversation stays on the left and real results appear on the right without navigation.
- Keep `/assistant` as the dedicated full-page layout, powered by the same shared search hook and result view.
- Preserve automatic search, flights-only behavior, flights-plus-hotels ordering, guided controls, current styling, and existing booking/detail handoffs.

## Verification
- Run the project typecheck and lint.
- Test Header ASK AI without navigation and Menu → Plan with AI on desktop and mobile-sized viewports.
- Confirm flights-only never requests/renders hotels and flights-plus-hotels renders flights above hotels.
