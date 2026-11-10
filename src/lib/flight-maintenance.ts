/** Frontend transaction guard; does not change provider or backend settings. */
export const FLIGHTS_UNDER_MAINTENANCE = true;

export function assertFlightTransactionsAvailable() {
  if (FLIGHTS_UNDER_MAINTENANCE) {
    throw new Error("Flight search and booking are under maintenance.");
  }
}