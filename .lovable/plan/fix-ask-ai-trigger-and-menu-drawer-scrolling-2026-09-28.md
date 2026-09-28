# Fix Ask AI trigger and menu drawer scrolling

## What changes
1. **Header ASK AI opens the AI chat drawer** (Trip Finder, suggestions, input — unchanged content). It will no longer open the hamburger menu.
2. **Old floating vertical "Ask AI" button removed** from the homepage entirely (removed from the code, not hidden). The header button becomes the only Ask AI trigger. On mobile, the small header Ask AI icon also opens the same chat drawer.
3. **Hamburger menu scrolls on laptop/desktop**: mouse wheel and touchpad scroll the menu list; the page behind stays fixed while the menu is open and scrolls normally again after closing.
4. Hamburger menu and AI chat stay fully separate. Logo, slim header, menu items and design unchanged.

## Technical details
- `AssistantDrawer.tsx`: make it controlled (`open`, `onOpenChange` props), delete the fixed `SheetTrigger` button; keep `SheetContent` and chat logic intact.
- `routes/index.tsx`: stop rendering `<AssistantDrawer />`.
- `Nav.tsx`: add separate `aiOpen` state; desktop and mobile Ask AI buttons call `setAiOpen(true)`; render `<AssistantDrawer open={aiOpen} onOpenChange={setAiOpen} />` once in Nav (available on all pages via header, only one trigger).
- Nav drawer scrolling: SheetContent as `flex flex-col` with `max-h-[calc(100dvh-4rem)] sm:max-h-[calc(100dvh-5rem)]`; inner list `flex-1 min-h-0 overflow-y-auto overscroll-contain`, `onWheel`/`onTouchMove` stopPropagation. Ensure Radix scroll lock is active (modal) and add a `useEffect` setting `document.body.style.overflow = "hidden"` while open, restored on close — because the header sits above the overlay, verify wheel events over the drawer reach the list.
- Verify with Playwright at 1280px: wheel over drawer changes its scrollTop while `window.scrollY` stays constant; header Ask AI opens chat drawer; zero floating Ask AI buttons.
