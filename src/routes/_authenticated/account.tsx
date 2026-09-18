import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Your Account — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Manage your Fly n Feel Holidays profile, saved travellers and booking history in one place.",
      },
      { property: "og:title", content: "Your Account — Fly n Feel Holidays" },
      {
        property: "og:description",
        content: "Manage your profile, saved travellers and bookings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountLayout,
});

const tabs = [
  { to: "/account", label: "Overview", exact: true },
  { to: "/account/profile", label: "Profile", exact: false },
  { to: "/account/travellers", label: "Travellers", exact: false },
  { to: "/account/bookings", label: "Bookings", exact: false },
  { to: "/account/support", label: "Support", exact: false },
] as const;

function AccountLayout() {
  const { email, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    // signOut() cancels + removes every private query before clearing the
    // session, so no private data can repaint from cache.
    await signOut();
    void navigate({ to: "/", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-32 sm:px-6 md:pt-40">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-gold">Fly n Feel Account</p>
            <h1 className="mt-2 font-display text-3xl tracking-tight text-foreground sm:text-4xl">
              Your account
            </h1>
            {email ? (
              <p className="mt-2 truncate text-sm text-muted-foreground">Signed in as {email}</p>
            ) : null}
          </div>
          <Button variant="outline" onClick={handleSignOut} className="shrink-0">
            <LogOut className="mr-2 size-4" aria-hidden />
            Sign out
          </Button>
        </header>

        <nav aria-label="Account sections" className="mt-8 overflow-x-auto">
          <ul className="flex min-w-max gap-2 border-b border-foreground/10 pb-px">
            {tabs.map((tab) => (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  activeOptions={{ exact: tab.exact }}
                  className="inline-block whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  activeProps={{
                    className: "text-foreground border-b-2 border-gold font-medium",
                  }}
                >
                  {tab.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  );
}
