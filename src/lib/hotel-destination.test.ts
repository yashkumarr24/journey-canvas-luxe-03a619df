import { describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { editHotelDestination, selectHotelDestination } from './hotel-destination';
import { hotelSearchSchema, toHotelSearchRequest, hotelSearchKey } from './hotel-search';

describe('hotel destination selection and handoff', () => {
  const selected = selectHotelDestination({ kind: 'hotel', id: 'test-property', name: 'Test property', location: 'Test city, Test country', label: 'Test property — Test city, Test country' });
  const values = { ...selected, checkIn: '2026-12-01', checkOut: '2026-12-04', rooms: [{ adults: 3, childAges: [7] }, { adults: 1, childAges: [] }], nationality: 'AE', currency: 'AED' };
  it('text edits clear stale hotel IDs', () => {
    const changed = { ...values, ...editHotelDestination('New city') };
    assert.equal(changed.destinationId, undefined);
    assert.equal(changed.destinationKind, undefined);
    assert.equal(toHotelSearchRequest(changed).destinationId, undefined);
  });
  it('selecting a city retains the authoritative region ID', () => {
    const city = selectHotelDestination({ kind: 'city', id: 'test-region', name: 'Test city', location: 'Test country', label: 'Test city, Test country' });
    assert.equal(city.destinationId, 'test-region'); assert.equal(city.destinationKind, 'city');
  });
  it('Explore more revalidation preserves request and cache key including all rooms', () => {
    const restored = hotelSearchSchema.parse(JSON.parse(JSON.stringify(values)));
    assert.deepEqual(toHotelSearchRequest(restored), { destination: values.destination, destinationKind: 'hotel', destinationId: 'test-property', checkIn: '2026-12-01', checkOut: '2026-12-04', rooms: [{ adults: 3, childAges: [7] }, { adults: 1, childAges: [] }], nationality: 'AE', currency: 'AED' });
    assert.deepEqual(hotelSearchKey(toHotelSearchRequest(restored)), hotelSearchKey(toHotelSearchRequest(values)));
  });
  it('dates and guest changes create a different search context', () => {
    assert.notDeepEqual(hotelSearchKey(toHotelSearchRequest(values)), hotelSearchKey(toHotelSearchRequest({ ...values, checkIn: '2026-12-02', rooms: [{ adults: 2, childAges: [] }] })));
  });
});