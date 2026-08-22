import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, UserRound } from "lucide-react";

import { AuthMessage } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth/auth-context";
import { useAddTraveller, useTravellers } from "@/lib/account/account-queries";

export const Route = createFileRoute("/_authenticated/account/travellers")({
  component: TravellersPage,
});

function TravellersPage() {
  const { userId } = useAuth();
  const travellers = useTravellers(userId);
  const addTraveller = useAddTraveller(userId);

  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<string>("");

  const reset = () => {
    setFirstName("");
    setLastName("");
    setDob("");
    setGender("");
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    addTraveller.mutate(
      {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        date_of_birth: dob || null,
        gender: gender || null,
        nationality: null,
      },
      {
        onSuccess: () => {
          reset();
          setOpen(false);
        },
      },
    );
  };

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl tracking-tight text-foreground">
              Saved travellers
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Names must match the traveller's government ID. Passport details are collected only at
              checkout, when the airline actually requires them.
            </p>
          </div>
          <Button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="shrink-0">
            <Plus className="mr-2 size-4" aria-hidden />
            Add traveller
          </Button>
        </div>

        {addTraveller.isError ? (
          <div className="mt-4">
            <AuthMessage tone="error">
              We couldn't save that traveller. Please check the details and try again.
            </AuthMessage>
          </div>
        ) : null}

        {open ? (
          <form onSubmit={onSubmit} className="mt-6 space-y-4 border-t border-foreground/10 pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="traveller-first">First name (as on ID)</Label>
                <Input
                  id="traveller-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  disabled={addTraveller.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="traveller-last">Last name (as on ID)</Label>
                <Input
                  id="traveller-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  disabled={addTraveller.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="traveller-dob">Date of birth</Label>
                <Input
                  id="traveller-dob"
                  type="date"
                  value={dob}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDob(e.target.value)}
                  disabled={addTraveller.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="traveller-gender">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger id="traveller-gender" disabled={addTraveller.isPending}>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={addTraveller.isPending}>
                {addTraveller.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    <span>Saving…</span>
                  </>
                ) : (
                  "Save traveller"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                disabled={addTraveller.isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      <section aria-live="polite">
        {travellers.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading saved travellers…
          </p>
        ) : travellers.isError ? (
          <AuthMessage tone="error">
            We couldn't load your travellers right now. Please try again.
          </AuthMessage>
        ) : travellers.data?.length ? (
          <ul className="space-y-3">
            {travellers.data.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-2xl border border-foreground/10 bg-[#F8F8F6] px-4 py-3"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/5 text-gold">
                  <UserRound className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {t.first_name} {t.last_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[t.date_of_birth, t.gender].filter(Boolean).join(" · ") || "No extra details"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-foreground/15 px-4 py-8 text-center text-sm text-muted-foreground">
            No saved travellers yet. Add one to speed up checkout.
          </p>
        )}
      </section>
    </div>
  );
}
