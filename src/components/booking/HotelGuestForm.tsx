import { useId, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/flight-search";
import { nationalityOptions } from "@/lib/hotel-search";
import type {
  HotelContactInput,
  HotelGuestInput,
  HotelGuestRequirements,
  HotelStay,
  PriceChange,
} from "@/types/booking";

/**
 * Hotel guest details.
 *
 * Which fields are required is decided by the SERVER (`requirements`), not by
 * the frontend, and re-validated on submit. Nothing here carries a price: a
 * price increase is acknowledged with a consent flag only.
 */

const TITLES = ["Mr", "Mrs", "Ms", "Dr"] as const;
const CHILD_TITLES = ["Mstr", "Miss"] as const;
const DIAL_CODES = ["+91", "+971", "+44", "+1", "+65", "+61", "+66"];

const NAME_RE = /^[A-Za-z][A-Za-z\s'-]{0,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\d{6,15}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const PASSPORT_RE = /^[A-Za-z0-9]{6,15}$/;

export interface HotelGuestFormProps {
  stay: HotelStay;
  requirements: HotelGuestRequirements;
  priceChange?: PriceChange;
  submitting: boolean;
  errorMessage?: string | null;
  onSubmit: (values: {
    guests: HotelGuestInput[];
    contact: HotelContactInput;
    specialRequests?: string;
    acceptPriceChange: boolean;
  }) => void;
}

interface Row extends HotelGuestInput {
  key: string;
}

function seedGuests(stay: HotelStay): Row[] {
  const rows: Row[] = [];
  stay.rooms.forEach((room, roomIdx) => {
    const roomIndex = roomIdx + 1;
    for (let i = 0; i < room.adults; i += 1) {
      rows.push({
        key: `r${roomIndex}-a${i}`,
        type: "adult",
        roomIndex,
        isLead: roomIndex === 1 && i === 0,
        title: "Mr",
        firstName: "",
        lastName: "",
      });
    }
    (room.childAges ?? []).forEach((age, i) => {
      rows.push({
        key: `r${roomIndex}-c${i}`,
        type: "child",
        roomIndex,
        title: "Mstr",
        firstName: "",
        lastName: "",
        age,
      });
    });
  });
  return rows;
}

export function HotelGuestForm({
  stay,
  requirements,
  priceChange,
  submitting,
  errorMessage,
  onSubmit,
}: HotelGuestFormProps) {
  const uid = useId();
  const [rows, setRows] = useState<Row[]>(() => seedGuests(stay));
  const [contact, setContact] = useState<HotelContactInput>({
    email: "",
    phone: "",
    dialCode: "+91",
  });
  const [specialRequests, setSpecialRequests] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [acceptPriceChange, setAcceptPriceChange] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const priceIncreased = priceChange?.direction === "increase";
  const fid = (name: string) => `${uid}-${name}`;

  const leadIndex = useMemo(() => rows.findIndex((row) => row.isLead), [rows]);

  const patchRow = (key: string, next: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)));

  const validate = () => {
    const found: Record<string, string> = {};

    rows.forEach((row, index) => {
      const named = row.isLead || requirements.allGuestNamesRequired;
      if (named) {
        if (!NAME_RE.test(row.firstName.trim())) found[`${row.key}.firstName`] = "Enter the first name as on ID.";
        if (!NAME_RE.test(row.lastName.trim())) found[`${row.key}.lastName`] = "Enter the last name as on ID.";
      }
      if (requirements.nationalityRequired && row.isLead && !row.nationality) {
        found[`${row.key}.nationality`] = "Select a nationality.";
      }
      if (requirements.dateOfBirthRequired && !row.dateOfBirth) {
        found[`${row.key}.dateOfBirth`] = "Enter the date of birth.";
      }
      if (requirements.panRequired && row.isLead && !PAN_RE.test((row.panNumber ?? "").toUpperCase())) {
        found[`${row.key}.panNumber`] = "Enter a valid PAN, e.g. ABCDE1234F.";
      }
      if (
        requirements.passportRequired &&
        (row.isLead || requirements.allGuestNamesRequired) &&
        !PASSPORT_RE.test(row.passportNumber ?? "")
      ) {
        found[`${row.key}.passportNumber`] = "Enter the passport number.";
      }
      if (row.type === "child" && (row.age === undefined || row.age < 0 || row.age > 17)) {
        found[`${row.key}.age`] = "Enter the child's age.";
      }
      // Keep index referenced so a stable key is always available for a11y.
      void index;
    });

    if (!EMAIL_RE.test(contact.email.trim())) found["contact.email"] = "Enter an email we can send the voucher to.";
    if (!PHONE_RE.test((contact.phone ?? "").replace(/\s/g, "")))
      found["contact.phone"] = "Enter a mobile number the hotel can reach.";
    if (!accepted) found.accepted = "Please accept the booking and cancellation terms.";
    if (priceIncreased && !acceptPriceChange) found.priceChange = "Please confirm the updated total to continue.";

    return found;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = document.getElementById(fid(Object.keys(found)[0]));
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.focus({ preventScroll: true });
      return;
    }

    onSubmit({
      guests: rows.map(({ key, ...guest }) => {
        void key;
        return {
          ...guest,
          firstName: guest.firstName.trim(),
          lastName: guest.lastName.trim(),
          panNumber: guest.panNumber ? guest.panNumber.toUpperCase() : undefined,
        };
      }),
      contact: {
        email: contact.email.trim(),
        phone: (contact.phone ?? "").replace(/\s/g, ""),
        dialCode: contact.dialCode,
      },
      specialRequests: specialRequests.trim() || undefined,
      acceptPriceChange,
    });
  };

  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={submitting} className="space-y-8">
      {priceIncreased && (
        <Alert role="status">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>The hotel re-priced this room</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              The amount payable is now{" "}
              {formatMoney(priceChange.current.amount, priceChange.current.currency)} —{" "}
              {formatMoney(priceChange.difference.amount, priceChange.difference.currency)} more than when you
              searched.
            </p>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                id={fid("priceChange")}
                checked={acceptPriceChange}
                onCheckedChange={(checked) => setAcceptPriceChange(checked === true)}
              />
              I accept the updated total.
            </label>
            {errors.priceChange && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {errors.priceChange}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {rows.map((row, index) => {
        const named = row.isLead || requirements.allGuestNamesRequired;
        const titles = row.type === "child" ? CHILD_TITLES : TITLES;
        return (
          <fieldset key={row.key} className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
            <legend className="px-1 text-sm font-medium">
              {row.isLead ? "Lead guest" : row.type === "child" ? "Child" : "Guest"} · Room {row.roomIndex}
              {index === leadIndex && (
                <span className="ml-2 text-xs text-muted-foreground">the hotel contacts this guest</span>
              )}
            </legend>

            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor={fid(`${row.key}.title`)}>Title</Label>
                <Select
                  value={row.title}
                  onValueChange={(value) => patchRow(row.key, { title: value })}
                >
                  <SelectTrigger id={fid(`${row.key}.title`)} className="mt-1.5 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {titles.map((title) => (
                      <SelectItem key={title} value={title}>
                        {title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor={fid(`${row.key}.firstName`)}>
                  First name {named ? "" : <span className="text-muted-foreground">(optional)</span>}
                </Label>
                <Input
                  id={fid(`${row.key}.firstName`)}
                  className="mt-1.5"
                  autoComplete="off"
                  maxLength={40}
                  value={row.firstName}
                  aria-invalid={!!errors[`${row.key}.firstName`]}
                  onChange={(event) => patchRow(row.key, { firstName: event.target.value })}
                />
                <FieldError message={errors[`${row.key}.firstName`]} />
              </div>

              <div>
                <Label htmlFor={fid(`${row.key}.lastName`)}>Last name</Label>
                <Input
                  id={fid(`${row.key}.lastName`)}
                  className="mt-1.5"
                  autoComplete="off"
                  maxLength={40}
                  value={row.lastName}
                  aria-invalid={!!errors[`${row.key}.lastName`]}
                  onChange={(event) => patchRow(row.key, { lastName: event.target.value })}
                />
                <FieldError message={errors[`${row.key}.lastName`]} />
              </div>

              {row.type === "child" && (
                <div>
                  <Label htmlFor={fid(`${row.key}.age`)}>Age at check-in</Label>
                  <Input
                    id={fid(`${row.key}.age`)}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={17}
                    className="mt-1.5"
                    value={row.age ?? ""}
                    aria-invalid={!!errors[`${row.key}.age`]}
                    onChange={(event) => patchRow(row.key, { age: Number(event.target.value || 0) })}
                  />
                  <FieldError message={errors[`${row.key}.age`]} />
                </div>
              )}

              {requirements.dateOfBirthRequired && (
                <div>
                  <Label htmlFor={fid(`${row.key}.dateOfBirth`)}>Date of birth</Label>
                  <Input
                    id={fid(`${row.key}.dateOfBirth`)}
                    type="date"
                    className="mt-1.5"
                    value={row.dateOfBirth ?? ""}
                    aria-invalid={!!errors[`${row.key}.dateOfBirth`]}
                    onChange={(event) => patchRow(row.key, { dateOfBirth: event.target.value })}
                  />
                  <FieldError message={errors[`${row.key}.dateOfBirth`]} />
                </div>
              )}

              {requirements.nationalityRequired && row.isLead && (
                <div>
                  <Label htmlFor={fid(`${row.key}.nationality`)}>Nationality</Label>
                  <Select
                    value={row.nationality ?? ""}
                    onValueChange={(value) => patchRow(row.key, { nationality: value })}
                  >
                    <SelectTrigger id={fid(`${row.key}.nationality`)} className="mt-1.5 w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {nationalityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={errors[`${row.key}.nationality`]} />
                </div>
              )}

              {requirements.panRequired && row.isLead && (
                <div>
                  <Label htmlFor={fid(`${row.key}.panNumber`)}>PAN number</Label>
                  <Input
                    id={fid(`${row.key}.panNumber`)}
                    className="mt-1.5 uppercase"
                    maxLength={10}
                    autoComplete="off"
                    value={row.panNumber ?? ""}
                    aria-invalid={!!errors[`${row.key}.panNumber`]}
                    onChange={(event) => patchRow(row.key, { panNumber: event.target.value.toUpperCase() })}
                  />
                  <FieldError message={errors[`${row.key}.panNumber`]} />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Required by the hotel for this rate.
                  </p>
                </div>
              )}

              {requirements.passportRequired && named && (
                <div>
                  <Label htmlFor={fid(`${row.key}.passportNumber`)}>Passport number</Label>
                  <Input
                    id={fid(`${row.key}.passportNumber`)}
                    className="mt-1.5"
                    maxLength={15}
                    autoComplete="off"
                    value={row.passportNumber ?? ""}
                    aria-invalid={!!errors[`${row.key}.passportNumber`]}
                    onChange={(event) => patchRow(row.key, { passportNumber: event.target.value })}
                  />
                  <FieldError message={errors[`${row.key}.passportNumber`]} />
                </div>
              )}
            </div>
          </fieldset>
        );
      })}

      <fieldset className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
        <legend className="px-1 text-sm font-medium">Contact details</legend>
        <p className="mt-2 text-xs text-muted-foreground">
          Your voucher and any hotel updates go here.
        </p>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor={fid("contact.email")}>Email</Label>
            <Input
              id={fid("contact.email")}
              type="email"
              className="mt-1.5"
              autoComplete="email"
              value={contact.email}
              aria-invalid={!!errors["contact.email"]}
              onChange={(event) => setContact({ ...contact, email: event.target.value })}
            />
            <FieldError message={errors["contact.email"]} />
          </div>

          <div>
            <Label htmlFor={fid("contact.phone")}>Mobile number</Label>
            <div className="mt-1.5 flex gap-2">
              <Select
                value={contact.dialCode}
                onValueChange={(value) => setContact({ ...contact, dialCode: value })}
              >
                <SelectTrigger className="w-28" aria-label="Country dialling code">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIAL_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id={fid("contact.phone")}
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={contact.phone}
                aria-invalid={!!errors["contact.phone"]}
                onChange={(event) => setContact({ ...contact, phone: event.target.value })}
              />
            </div>
            <FieldError message={errors["contact.phone"]} />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor={fid("specialRequests")}>
              Special requests <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={fid("specialRequests")}
              className="mt-1.5"
              rows={3}
              maxLength={400}
              placeholder="Late check-in, high floor, adjoining rooms…"
              value={specialRequests}
              onChange={(event) => setSpecialRequests(event.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Requests are passed to the hotel and depend on availability on arrival.
            </p>
          </div>
        </div>
      </fieldset>

      {errorMessage && (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>We couldn't save these details</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            id={fid("accepted")}
            checked={accepted}
            onCheckedChange={(checked) => setAccepted(checked === true)}
            aria-invalid={!!errors.accepted}
          />
          <span>
            I confirm the guest names match their photo ID and I accept the room's cancellation policy and the
            booking terms.
          </span>
        </label>
        <FieldError message={errors.accepted} />

        <Button type="submit" size="lg" className="mt-6 w-full sm:w-auto" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Saving guest details…
            </>
          ) : (
            "Continue to payment"
          )}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          No payment is taken yet — you'll see the final total on the next step.
        </p>
      </div>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">
      <span aria-hidden="true">⚠ </span>
      {message}
    </p>
  );
}
