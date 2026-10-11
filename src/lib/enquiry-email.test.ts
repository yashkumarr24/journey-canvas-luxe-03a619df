import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnquiryEmails, type EnquiryDetails } from './enquiry-email';

const enquiry: EnquiryDetails = {
  name: 'Asha Rao',
  email: 'asha@example.com',
  phone: '+91 90000 00000',
  service: 'Visa',
  destination: 'Dubai',
  message: 'Need a tourist visa for two.',
  source_page: 'contact',
};

const BUSINESS = 'Yashworks.x@gmail.com';

describe('enquiry email routing', () => {
  it('sends the business notification to the business address, not the customer', () => {
    const [notification] = buildEnquiryEmails(enquiry, BUSINESS);
    assert.equal(notification.to, BUSINESS);
  });

  it('still sends a confirmation to the customer own address', () => {
    const emails = buildEnquiryEmails(enquiry, BUSINESS);
    assert.equal(emails.length, 2);
    assert.equal(emails[1].to, 'asha@example.com');
    assert.ok(emails[1].subject.includes('We received your enquiry'));
  });

  it('carries the details the business needs in the notification', () => {
    const [notification] = buildEnquiryEmails(enquiry, BUSINESS);
    assert.equal(notification.subject, 'New enquiry: Visa — Asha Rao');
    assert.ok(notification.html.includes('+91 90000 00000'));
    assert.ok(notification.html.includes('Dubai'));
    assert.ok(notification.html.includes('Need a tourist visa for two.'));
  });

  it('never exposes the business address to the customer', () => {
    const [, confirmation] = buildEnquiryEmails(enquiry, BUSINESS);
    assert.ok(!confirmation.html.includes(BUSINESS));
  });

  it('escapes html typed by a visitor in the notification', () => {
    const [notification] = buildEnquiryEmails(
      { ...enquiry, message: '<script>x</script>' },
      BUSINESS,
    );
    assert.ok(!notification.html.includes('<script>x</script>'));
    assert.ok(notification.html.includes('&lt;script&gt;x&lt;/script&gt;'));
  });
});
