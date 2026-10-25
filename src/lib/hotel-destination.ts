import type { HotelDestinationSuggestion } from '@/types/booking';

/** Every text edit invalidates the previous catalogue selection, even similar names. */
export function editHotelDestination(destination: string) {
  return { destination, destinationKind: undefined, destinationId: undefined };
}

export function selectHotelDestination(item: HotelDestinationSuggestion) {
  return { destination: item.label, destinationKind: item.kind, destinationId: item.id };
}