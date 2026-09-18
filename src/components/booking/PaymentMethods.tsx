import { CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { PaymentMethodOption } from "@/types/booking";

/**
 * Payment method picker. The selection is a hint for the payment sheet only —
 * the amount and the provider order are decided server-side.
 */

const ICONS: Record<string, typeof CreditCard> = {
  upi: Smartphone,
  card: CreditCard,
  netbanking: Landmark,
  wallet: Wallet,
};

export interface PaymentMethodsProps {
  methods: PaymentMethodOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function PaymentMethods({ methods, value, onChange, disabled }: PaymentMethodsProps) {
  if (methods.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Payment options will appear here once our payment desk is switched on.
      </p>
    );
  }

  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      className="grid gap-3 sm:grid-cols-2"
      aria-label="Payment method"
    >
      {methods.map((method) => {
        const Icon = ICONS[method.id] ?? CreditCard;
        return (
          <Label
            key={method.id}
            htmlFor={`method-${method.id}`}
            data-selected={value === method.id}
            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-foreground/10 p-4 transition-colors data-[selected=true]:border-gold has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <RadioGroupItem
              id={`method-${method.id}`}
              value={method.id}
              disabled={disabled || !method.enabled}
              className="mt-0.5"
            />
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{method.label}</span>
              {method.description && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{method.description}</span>
              )}
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}
