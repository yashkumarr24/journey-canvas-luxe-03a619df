# Project architecture rules

- Add database changes as numbered, additive migrations; catalogue lookup indexes must preserve existing sync semantics and data.- Keep homepage search modes in the presentation layer and hand validated flight/hotel requests to existing search flows; this protects provider and booking logic from navigation redesigns.
