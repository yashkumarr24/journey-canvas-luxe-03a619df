/**
 * Shared shell for the authentication pages.
 *
 * Uses only the existing Fly n Feel design tokens (pearl surfaces, red accent,
 * Inter Tight display font). No new design system is introduced.
 */

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ eyebrow, title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto w-full max-w-md px-4 pb-20 pt-32 sm:px-6 md:pt-40">
        <div className="rounded-3xl border border-foreground/10 bg-[#F8F8F6] p-6 shadow-[var(--shadow-soft)] sm:p-8">
          <p className="text-[0.7rem] uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? (
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          You can always{" "}
          <Link to="/flights" className="underline underline-offset-4 hover:text-foreground">
            search flights as a guest
          </Link>{" "}
          — an account is only needed to save travellers and view bookings.
        </p>
      </main>
      <Footer />
    </div>
  );
}

/** Accessible status/error region shared by every auth form. */
export function AuthMessage({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  if (!children) return null;
  const styles =
    tone === "error"
      ? "border-destructive/30 bg-destructive/5 text-destructive"
      : tone === "success"
        ? "border-emerald-600/30 bg-emerald-600/5 text-emerald-700"
        : "border-foreground/15 bg-foreground/5 text-muted-foreground";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}
