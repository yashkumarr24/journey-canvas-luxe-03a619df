import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { AuthMessage } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { useProfile, useUpsertProfile } from "@/lib/account/account-queries";

export const Route = createFileRoute("/_authenticated/account/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { userId, email } = useAuth();
  const profile = useProfile(userId);
  const save = useUpsertProfile(userId, email);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile.data) return;
    setFirstName(profile.data.first_name ?? "");
    setLastName(profile.data.last_name ?? "");
    setPhone(profile.data.phone ?? "");
  }, [profile.data]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSaved(false);
    save.mutate(
      {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <section className="max-w-xl rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <h2 className="font-display text-xl tracking-tight text-foreground">Profile & contact</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Used by our travel desk to reach you about a booking. Your sign-in email is managed by your
        account and can't be edited here.
      </p>

      {profile.isPending ? (
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          Loading your profile…
        </p>
      ) : (
        <>
          {profile.isError ? (
            <div className="mt-4">
              <AuthMessage tone="error">
                We couldn't load your profile right now. Please try again.
              </AuthMessage>
            </div>
          ) : null}
          {saved ? (
            <div className="mt-4">
              <AuthMessage tone="success">Your details have been saved.</AuthMessage>
            </div>
          ) : null}
          {save.isError ? (
            <div className="mt-4">
              <AuthMessage tone="error">
                We couldn't save those details. Please check them and try again.
              </AuthMessage>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-first">First name</Label>
                <Input
                  id="profile-first"
                  value={firstName}
                  autoComplete="given-name"
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={save.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-last">Last name</Label>
                <Input
                  id="profile-last"
                  value={lastName}
                  autoComplete="family-name"
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={save.isPending}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-email">Email address</Label>
              <Input id="profile-email" value={email ?? ""} readOnly disabled />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-phone">Phone number</Label>
              <Input
                id="profile-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 90000 00000"
                disabled={save.isPending}
              />
            </div>

            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  <span>Saving…</span>
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
