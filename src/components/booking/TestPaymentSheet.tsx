import { FlaskConical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/flight-search";
import type { PaymentOrder } from "@/types/booking";

/**
 * Stand-in for the Razorpay sheet, shown only while the real payment endpoints
 * and credentials are unavailable. It moves no money and stores no card data:
 * it just produces the same acknowledgement shape the provider would, so the
 * success and failure journeys can be walked end to end.
 */

export interface TestPaymentSheetProps {
  order: PaymentOrder | null;
  onAuthorise: (paymentId: string) => void;
  onFail: () => void;
  onDismiss: () => void;
}

export function TestPaymentSheet({ order, onAuthorise, onFail, onDismiss }: TestPaymentSheetProps) {
  return (
    <Dialog open={Boolean(order)} onOpenChange={(open) => (!open ? onDismiss() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <FlaskConical className="size-5 text-gold" aria-hidden="true" /> Test payment
          </DialogTitle>
          <DialogDescription>
            This is a rehearsal of the payment step. No card details are collected and no money moves.
          </DialogDescription>
        </DialogHeader>

        {order && (
          <div className="rounded-2xl border border-foreground/10 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Amount</p>
            <p className="mt-1 font-display text-3xl leading-none">
              {formatMoney(order.amount.amount, order.amount.currency)}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Booking {order.bookingReference} · Order {order.orderId}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Cancel
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onFail}>
              Simulate failure
            </Button>
            <Button type="button" onClick={() => onAuthorise(`test_pay_${Date.now().toString(36)}`)}>
              Simulate success
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
