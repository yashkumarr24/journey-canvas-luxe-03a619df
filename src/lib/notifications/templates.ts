/**
 * PHASE 13 — notification templates.
 *
 * One place decides, per event type: who it is for, which channels it would use
 * and the default wording. Booking, payment, cancellation and support code then
 * only names the event — it never composes messages or picks providers.
 *
 * Copy rules:
 *  - never promise a ticket, voucher or money movement that has not happened,
 *  - never include a card detail, OTP, passport/document number or full contact,
 *  - keep the body short enough to survive an SMS later.
 */

import type { NotificationChannel } from "@/types/notifications";
import type { NotificationType } from "@/types/operations";

export interface NotificationTemplate {
  audience: "customer" | "admin";
  channels: NotificationChannel[];
  title: string;
  /** `{ref}` is replaced with the booking reference when one is present. */
  body: string;
}

export const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  booking_created: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Booking created",
    body: "Booking {ref} has been created and is awaiting payment.",
  },
  booking_pending: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Booking in progress",
    body: "Booking {ref} is being processed. We will update you as soon as it is confirmed.",
  },
  booking_confirmed: {
    audience: "customer",
    channels: ["in_app", "email", "whatsapp"],
    title: "Booking confirmed",
    body: "Booking {ref} is confirmed.",
  },
  booking_failed: {
    audience: "customer",
    channels: ["in_app", "email", "sms"],
    title: "Booking could not be confirmed",
    body: "Booking {ref} could not be confirmed. Our team is reviewing it.",
  },
  booking_cancelled: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Booking cancelled",
    body: "Booking {ref} is now cancelled.",
  },
  booking_update: {
    audience: "customer",
    channels: ["in_app", "email", "whatsapp"],
    title: "Important booking update",
    body: "There is an update on booking {ref}. Open the booking for details.",
  },
  payment_successful: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Payment successful",
    body: "We have recorded your payment for booking {ref}.",
  },
  payment_failed: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Payment failed",
    body: "The payment for booking {ref} did not go through. You can try again.",
  },
  payment_refunded: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Refund update",
    body: "The refund for booking {ref} has been marked complete by our team.",
  },
  cancellation_requested: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Cancellation requested",
    body: "We have received your cancellation request for booking {ref}.",
  },
  cancellation_status_changed: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Cancellation update",
    body: "The cancellation request for booking {ref} has been updated.",
  },
  refund_status_changed: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Refund update",
    body: "The refund status for booking {ref} has been updated.",
  },
  documents_available: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Travel documents available",
    body: "Documents for booking {ref} are now available in your account.",
  },
  support_request_created: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Support request received",
    body: "Our team has your request and will reply here.",
  },
  support_request_replied: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Support team replied",
    body: "There is a new reply on your support request.",
  },
  support_request_updated: {
    audience: "customer",
    channels: ["in_app", "email"],
    title: "Support request updated",
    body: "The status of your support request has changed.",
  },
};

export function renderTemplate(
  type: NotificationType,
  reference?: string | null,
): { title: string; body: string } {
  const template = NOTIFICATION_TEMPLATES[type];
  const ref = reference ?? "your booking";
  return { title: template.title, body: template.body.replace("{ref}", ref) };
}
