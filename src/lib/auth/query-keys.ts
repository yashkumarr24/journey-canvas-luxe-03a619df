/**
 * Query-key factory for PRIVATE (per-user) data.
 *
 * Every private key is namespaced under `private` AND scoped by the
 * authenticated user's id. Two consequences:
 *
 *  - Two different users can never read each other's cached data, even inside
 *    the same browser tab (their keys differ).
 *  - Sign-out can wipe exactly the private half of the cache while leaving
 *    public flight/hotel search results intact.
 *
 * Public data (flight search, hotel search) keeps its own top-level keys and
 * must NOT be added here.
 */

export const PRIVATE_KEY_ROOT = "private" as const;

export const privateKeys = {
  all: (userId: string) => [PRIVATE_KEY_ROOT, userId] as const,
  profile: (userId: string) => [PRIVATE_KEY_ROOT, userId, "profile"] as const,
  travellers: (userId: string) => [PRIVATE_KEY_ROOT, userId, "travellers"] as const,
  bookings: (userId: string) => [PRIVATE_KEY_ROOT, userId, "bookings"] as const,
  booking: (userId: string, reference: string) =>
    [PRIVATE_KEY_ROOT, userId, "bookings", reference] as const,
};

/** Matches every private query regardless of user — used on sign-out. */
export const privateQueryFilter = { queryKey: [PRIVATE_KEY_ROOT] } as const;
