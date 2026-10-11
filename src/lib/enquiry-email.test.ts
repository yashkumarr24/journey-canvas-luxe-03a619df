import { expect, test } from "bun:test";
import { buildEnquiryEmails, type EnquiryDetails } from "./enquiry-email";

const enquiry: EnquiryDetails = {
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "+91 90000 00000",
  service: "Visa",
  destination: "Dubai",
  message: "Need a tourist visa for two.",
  source_page: "contact",
};

test("business notification goes to the business address, not the customer", () => {
  const [notification] = buildEnquiryEmails(enquiry, "Yashworks.x@gmail.com");
  expect(notification.to).toBe("Yashworks.x@gmail.com");
});

test("customer confirmation is still sent to the customer's own address", () => {
  const emails = buildEnquiryEmails(enquiry, "Yashworks.x@gmail.com");
  expect(emails).toHaveLength(2);
  expect(emails[1].to).toBe("asha@example.com");
  expect(emails[1].subject).toContain("We received your enquiry");
});

test("business notification carries the details the business needs", () => {
  const [notification] = buildEnquiryEmails(enquiry, "Yashworks.x@gmail.com");
  expect(notification.subject).toBe("New enquiry: Visa — Asha Rao");
  expect(notification.html).toContain("+91 90000 00000");
  expect(notification.html).toContain("Dubai");
  expect(notification.html).toContain("Need a tourist visa for two.");
});

test("customer confirmation never exposes the business address to the customer", () => {
  const [, confirmation] = buildEnquiryEmails(enquiry, "Yashworks.x@gmail.com");
  expect(confirmation.html).not.toContain("Yashworks.x@gmail.com");
});

test("html from the visitor is escaped in the business notification", () => {
  const [notification] = buildEnquiryEmails(
    { ...enquiry, message: "<script>x</script>" },
    "Yashworks.x@gmail.com",
  );
  expect(notification.html).not.toContain("<script>x</script>");
  expect(notification.html).toContain("&lt;script&gt;x&lt;/script&gt;");
});
