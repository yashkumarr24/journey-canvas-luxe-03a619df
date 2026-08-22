import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ContactInput,
  PassengerCounts,
  PassengerType,
  TravellerInput,
  TravellerRequirements,
} from "@/types/booking";

/**
 * Traveller + contact capture for a reviewed fare.
 *
 * The validation here is a courtesy to the customer, not a security control:
 * the backend re-validates every field, re-counts the passengers against the
 * original search and owns the price. This form never sends an amount.
 */

export interface TravellerFormProps {
  passengers: PassengerCounts;
  requirements: TravellerRequirements;
  submitting: boolean;
  /** Present when the server re-priced the fare upward. */
  priceChangeNotice?: string;
  onSubmit: (values: { travellers: TravellerInput[]; contact: ContactInput; acceptPriceChange: boolean }) => void;
}

const TITLES = ["Mr", "Mrs", "Ms", "Miss", "Mstr"];
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{0,49}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PHONE_RE = /^\+?[0-9]{8,15}$/;
const PASSPORT_RE = /^[A-Za-z0-9]{5,20}$/;

const TYPE_LABEL: Record<PassengerType, string> = {
  adult: "Adult",
  child: "Child (2–11)",
  infant: "Infant (under 2)",
};

function blank(type: PassengerType): TravellerInput {
  return { type, title: type === "adult" ? "Mr" : undefined, firstName: "", lastName: "" };
}

function buildRoster(passengers: PassengerCounts): TravellerInput[] {
  return [
    ...Array.from({ length: passengers.adults ?? 0 }, () => blank("adult")),
    ...Array.from({ length: passengers.children ?? 0 }, () => blank("child")),
    ...Array.from({ length: passengers.infants ?? 0 }, () => blank("infant")),
  ];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TravellerForm({
  passengers,
  requirements,
  submitting,
  priceChangeNotice,
  onSubmit,
}: TravellerFormProps) {
  const roster = useMemo(() => buildRoster(passengers), [passengers]);
  const [travellers, setTravellers] = useState<TravellerInput[]>(roster);
  const [contact, setContact] = useState<ContactInput>({ email: "", phone: "" });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const update = (index: number, patch: Partial<TravellerInput>) => {
    setTravellers((current) => current.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const validate = (): string[] => {
    const found: string[] = [];

    travellers.forEach((traveller, index) => {
      const who = `Traveller ${index + 1}`;
      if (!NAME_RE.test(traveller.firstName.trim())) found.push(`${who}: enter a valid first name.`);
      if (!NAME_RE.test(traveller.lastName.trim())) found.push(`${who}: enter a valid last name.`);

      const needsDob = requirements.dateOfBirthRequired || traveller.type !== "adult";
      if (needsDob && !traveller.dateOfBirth) found.push(`${who}: date of birth is required.`);
      if (traveller.dateOfBirth && traveller.dateOfBirth > today()) {
        found.push(`${who}: date of birth cannot be in the future.`);
      }

      if (requirements.nationalityRequired && !traveller.nationality) {
        found.push(`${who}: nationality is required for this flight.`);
      }

      if (requirements.passportRequired) {
        if (!traveller.passportNumber || !PASSPORT_RE.test(traveller.passportNumber)) {
          found.push(`${who}: enter a valid passport number.`);
        }
        if (!traveller.passportIssuingCountry) found.push(`${who}: passport issuing country is required.`);
        if (requirements.passportExpiryRequired && !traveller.passportExpiry) {
          found.push(`${who}: passport expiry date is required.`);
        }
      }
      if (traveller.passportExpiry && traveller.passportExpiry <= today()) {
        found.push(`${who}: the passport has expired.`);
      }
    });

    if (!EMAIL_RE.test(contact.email.trim())) found.push("Enter a valid contact email address.");
    if (!PHONE_RE.test(contact.phone.replace(/[\s\-()]/g, ""))) found.push("Enter a valid contact phone number.");
    if (priceChangeNotice && !accepted) found.push("Please confirm the updated total before continuing.");

    return found;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (found.length > 0) return;

    onSubmit({
      travellers: travellers.map((traveller) => ({
        ...traveller,
        firstName: traveller.firstName.trim(),
        lastName: traveller.lastName.trim(),
        // Empty strings would fail server validation; send nothing instead.
        nationality: traveller.nationality || undefined,
        passportNumber: traveller.passportNumber?.trim().toUpperCase() || undefined,
        passportExpiry: traveller.passportExpiry || undefined,
        passportIssuingCountry: traveller.passportIssuingCountry || undefined,
        dateOfBirth: traveller.dateOfBirth || undefined,
      })),
      contact: { email: contact.email.trim().toLowerCase(), phone: contact.phone.replace(/[\s\-()]/g, "") },
      acceptPriceChange: accepted,
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {travellers.map((traveller, index) => (
        <fieldset
          key={`${traveller.type}-${index}`}
          className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6"
        >
          <legend className="px-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {TYPE_LABEL[traveller.type]} · Traveller {index + 1}
          </legend>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`title-${index}`}>Title</Label>
              <Select
                value={traveller.title ?? ""}
                onValueChange={(value) => update(index, { title: value })}
              >
                <SelectTrigger id={`title-${index}`}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {TITLES.map((title) => (
                    <SelectItem key={title} value={title}>
                      {title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`first-${index}`}>First name (as on ID)</Label>
              <Input
                id={`first-${index}`}
                autoComplete="off"
                maxLength={50}
                value={traveller.firstName}
                onChange={(event) => update(index, { firstName: event.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`last-${index}`}>Last name (as on ID)</Label>
              <Input
                id={`last-${index}`}
                autoComplete="off"
                maxLength={50}
                value={traveller.lastName}
                onChange={(event) => update(index, { lastName: event.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`dob-${index}`}>
                Date of birth
                {requirements.dateOfBirthRequired || traveller.type !== "adult" ? "" : " (optional)"}
              </Label>
              <Input
                id={`dob-${index}`}
                type="date"
                max={today()}
                value={traveller.dateOfBirth ?? ""}
                onChange={(event) => update(index, { dateOfBirth: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`gender-${index}`}>Gender</Label>
              <Select
                value={traveller.gender ?? ""}
                onValueChange={(value) => update(index, { gender: value as TravellerInput["gender"] })}
              >
                <SelectTrigger id={`gender-${index}`}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(requirements.nationalityRequired || requirements.passportRequired) && (
              <div className="space-y-2">
                <Label htmlFor={`nationality-${index}`}>Nationality (2-letter code)</Label>
                <Input
                  id={`nationality-${index}`}
                  maxLength={2}
                  placeholder="IN"
                  value={traveller.nationality ?? ""}
                  onChange={(event) =>
                    update(index, { nationality: event.target.value.toUpperCase().slice(0, 2) })
                  }
                />
              </div>
            )}

            {requirements.passportRequired && (
              <>
                <div className="space-y-2">
                  <Label htmlFor={`passport-${index}`}>Passport number</Label>
                  <Input
                    id={`passport-${index}`}
                    autoComplete="off"
                    maxLength={20}
                    value={traveller.passportNumber ?? ""}
                    onChange={(event) =>
                      update(index, { passportNumber: event.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`passport-country-${index}`}>Issuing country (2-letter code)</Label>
                  <Input
                    id={`passport-country-${index}`}
                    maxLength={2}
                    placeholder="IN"
                    value={traveller.passportIssuingCountry ?? ""}
                    onChange={(event) =>
                      update(index, {
                        passportIssuingCountry: event.target.value.toUpperCase().slice(0, 2),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`passport-expiry-${index}`}>Passport expiry</Label>
                  <Input
                    id={`passport-expiry-${index}`}
                    type="date"
                    min={today()}
                    value={traveller.passportExpiry ?? ""}
                    onChange={(event) => update(index, { passportExpiry: event.target.value })}
                  />
                </div>
              </>
            )}
          </div>

          <label className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            <Checkbox
              checked={traveller.saveToProfile ?? false}
              onCheckedChange={(checked) => update(index, { saveToProfile: checked === true })}
            />
            Save this traveller to my account for faster booking next time
          </label>
        </fieldset>
      ))}

      <fieldset className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
        <legend className="px-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Contact details
        </legend>
        <p className="mt-2 text-sm text-muted-foreground">
          Your ticket and any airline updates go here.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={contact.email}
              onChange={(event) => setContact((c) => ({ ...c, email: event.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              type="tel"
              autoComplete="tel"
              maxLength={20}
              placeholder="+919999999999"
              value={contact.phone}
              onChange={(event) => setContact((c) => ({ ...c, phone: event.target.value }))}
              required
            />
          </div>
        </div>
      </fieldset>

      {priceChangeNotice && (
        <label className="flex items-start gap-3 rounded-3xl border border-gold/40 bg-gold/5 p-5 text-sm">
          <Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} />
          <span>{priceChangeNotice}</span>
        </label>
      )}

      {errors.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? "Saving details…" : "Continue to payment"}
        </Button>
        <p className="text-xs text-muted-foreground">
          No payment is taken yet — you'll review the total on the next step.
        </p>
      </div>
    </form>
  );
}
