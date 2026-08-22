import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, MailWarning, Plane, UserRound, Users } from "lucide-react";

import { useAuth } from "@/lib/auth/auth-context";
import { useProfile, useTravellers } from "@/lib/account/account-queries";

export const Route = createFileRoute("/_authenticated/account/")({
  component: AccountOverview,
});

function AccountOverview() {
  const { userId, email, emailVerified } = useAuth();
  const profile = useProfile(userId);
  const travellers = useTravellers(userId);

  const name = [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <section
        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
          emailVerified
            ? "border-emerald-600/25 bg-emerald-600/5 text-emerald-700"
            : "border-amber-500/30 bg-amber-500/5 text-amber-700"
        }`}
        aria-live="polite"
      >
        {emailVerified ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <p className="min-w-0">
          {emailVerified
            ? `Your email address ${email ?? ""} is verified.`
            : "Your email address isn't verified yet. Open the confirmation link we sent you. Guest bookings are unaffected."}
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <OverviewCard
          icon={<UserRound className="size-4" aria-hidden />}
          title="Profile"
          body={
            profile.isPending
              ? "Loading…"
              : name || profile.data?.phone
                ? `${name || "Name not set"}${profile.data?.phone ? ` · ${profile.data.phone}` : ""}`
                : "Add your name and contact number so our desk can reach you quickly."
          }
          to="/account/profile"
          cta="Manage profile"
        />
        <OverviewCard
          icon={<Users className="size-4" aria-hidden />}
          title="Saved travellers"
          body={
            travellers.isPending
              ? "Loading…"
              : travellers.data?.length
                ? `${travellers.data.length} saved traveller${travellers.data.length === 1 ? "" : "s"}.`
                : "Save traveller details once and reuse them at checkout."
          }
          to="/account/travellers"
          cta="Manage travellers"
        />
        <OverviewCard
          icon={<Plane className="size-4" aria-hidden />}
          title="Bookings"
          body="Your flight and hotel bookings will appear here once booking goes live."
          to="/account/bookings"
          cta="View bookings"
        />
        <OverviewCard
          icon={<Plane className="size-4 rotate-45" aria-hidden />}
          title="Search flights"
          body="Search and book with or without an account — nothing is gated behind sign-in."
          to="/flights"
          cta="Search flights"
        />
      </div>
    </div>
  );
}

function OverviewCard({
  icon,
  title,
  body,
  to,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  to: "/account/profile" | "/account/travellers" | "/account/bookings" | "/flights";
  cta: string;
}) {
  return (
    <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
      <h2 className="flex items-center gap-2 font-display text-lg tracking-tight text-foreground">
        <span className="text-gold">{icon}</span>
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Link
        to={to}
        className="mt-4 inline-block text-sm text-gold underline underline-offset-4"
      >
        {cta}
      </Link>
    </section>
  );
}
