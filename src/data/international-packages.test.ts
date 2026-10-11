import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import packages from './international-packages.json';
describe('international source quotations', () => {
  it('retains all thirty distinct European itineraries and five individual trips', () => {
    assert.equal(packages.length,35);
    const europe = packages.filter(p => p.source.startsWith('All_Europe'));
    assert.equal(europe.length,30);
    assert.equal(new Set(packages.map(p=>p.slug)).size,35);
    assert.equal(europe.filter(p=>p.name==='Switzerland Holiday Package').length,3);
    for (const p of packages) assert.equal(p.itinerary.length, Number(p.duration.match(/(\d+)\s*Days/)?.[1]));
  });
  it('keeps Bali prices and hotels isolated across four options', () => {
    const p=packages.find(p=>p.slug.endsWith('1295')); assert.ok(p);
    assert.deepEqual(p.options.map(o=>o.price[0]),['INR 38,999/- Per Person + GST 5% Extra','INR 38,499/- Per Person + GST 5% Extra','INR 57,499/- Per Person + GST 5% Extra','INR 57,999/- Per Person + GST 5% Extra']);
    assert.equal(p.options[0].tables[0].rows[0][2],'Golden Tulip Jineng Resort Kuta/Similar');
    assert.equal(p.options[1].tables[0].rows[0][2],'Ramada By Wyndham Bali Sunset Road Kuta/Similar');
    assert.equal(p.itinerary[0].date,'06 Nov 2026');
  });
  it('preserves all Georgia hotel-and-price associations including option four', () => {
    const p=packages.find(p=>p.slug.endsWith('1423'));assert.ok(p);
    assert.deepEqual(p.options.map(o=>o.price[0]),['INR 55,500/- Per Person','INR 55,700/- Per Person','INR 63,500/- Per Person','INR 82,500/- Per Person']);
    assert.deepEqual(p.options.map(o=>o.tables[0].rows[0][1]),['Hotel Monograph Freedom Square','Hotel Golden Tulip Design','Hotel Royal Tulip','Hotel Tbilisi Marriot']);
    assert.equal(p.options[3].tables[0].rows.length,4);
  });
  it('keeps Singapore hotel rates separate from the source flight fare', () => {
    const p=packages.find(p=>p.slug.endsWith('1329'));assert.ok(p);
    assert.deepEqual(p.options.map(o=>o.price[0]),['INR 68,790/- PP','INR 73,200/- PP','INR 75,200/- PP']);
    assert.ok(p.tour.some(f=>f.value==='INR 29,750/- Per Person Return Ways'));
  });
  it('preserves multi-city trips and Vietnam meals, visa, GST and special notes', () => {
    const dubai=packages.find(p=>p.slug.endsWith('1416'));assert.ok(dubai);
    assert.deepEqual(dubai.cities,['Dubai','Abu Dhabi']); assert.equal(dubai.itinerary.length,8);
    const p=packages.find(p=>p.slug.endsWith('1320'));assert.ok(p);
    assert.equal(p.options[0].price[0],'INR 73,900/- Per Person Including Visa');
    assert.equal(p.itinerary[8].meals,'Brunch');
    assert.ok(p.inclusions.includes('GST 5%'));
    assert.ok(p.notes.flatMap(g=>g.items).some(t=>t.includes('GST/TCs we’re not charging')));
    assert.ok(p.notes.flatMap(g=>g.items).some(t=>t.includes('12$/person')));
  });
});
