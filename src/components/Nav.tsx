import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, BriefcaseBusiness, CircleHelp, Coins, Compass, Gift, Languages, Menu, MessageSquare, PlaneTakeoff, UserRound, BedDouble, ArrowUpRight } from "lucide-react";
import logo from "@/assets/flynfeel-logo.webp";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function Nav() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const close = () => setOpen(false);
  const entries = [
    { label: "Flights", to: "/flights" as const, icon: PlaneTakeoff },
    { label: "Hotels", to: "/hotels" as const, icon: BedDouble },
    { label: "Holidays", to: "/holidays" as const, icon: Gift },
    { label: "Plan with AI", to: "/assistant" as const, icon: Bot },
    { label: "Destinations", to: "/domestic" as const, icon: Compass },
    { label: "Offers", to: "/holidays" as const, icon: Gift },
    { label: "Help & Support", to: "/contact" as const, icon: CircleHelp },
    { label: "Trips / My Bookings", to: "/account/bookings" as const, icon: BriefcaseBusiness },
    { label: isAuthenticated ? "My Account" : "Sign In / Sign Up", to: (isAuthenticated ? "/account" : "/auth/login") as "/account" | "/auth/login", icon: UserRound },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-foreground/10 bg-background/95 shadow-[var(--shadow-soft)] backdrop-blur-md">
      <nav aria-label="Main navigation" className="mx-auto grid h-20 w-full max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:h-24 sm:gap-6 sm:px-6 lg:px-10">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu" className="size-10 shrink-0 border border-foreground/10 hover:bg-secondary"><Menu className="size-5" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[min(88vw,340px)] overflow-y-auto border-r border-foreground/10 bg-background px-0 pb-6 pt-14 shadow-[var(--shadow-luxe)]">
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            <SheetDescription className="sr-only">Explore travel and account pages.</SheetDescription>
            <div className="space-y-1 px-3">
              {entries.slice(0, 4).map(({ label, to, icon: Icon }) => (
                <Link key={label} to={to} onClick={close} className="flex min-h-12 items-center gap-4 border-l-2 border-transparent px-4 text-sm font-medium text-foreground transition-colors hover:border-gold hover:bg-secondary" activeProps={{ className: "border-gold bg-secondary" }}><Icon className="size-4 shrink-0 text-gold" aria-hidden="true" />{label}</Link>
              ))}
            </div>
            <div className="mx-5 my-4 border-t border-border" />
            <div className="space-y-1 px-3">
              {entries.slice(4, 9).map(({ label, to, icon: Icon }) => (
                <Link key={label} to={to} onClick={close} className="flex min-h-12 items-center gap-4 border-l-2 border-transparent px-4 text-sm font-medium text-foreground transition-colors hover:border-gold hover:bg-secondary" activeProps={{ className: "border-gold bg-secondary" }}><Icon className="size-4 shrink-0 text-gold" aria-hidden="true" />{label}</Link>
              ))}
            </div>
            <div className="mx-5 my-4 border-t border-border" />
            <div className="space-y-1 px-3">
              <div className="flex min-h-12 items-center gap-4 px-4 text-sm text-muted-foreground" title="English is the current site language"><Languages className="size-4 shrink-0" />Language <span className="ml-auto text-foreground">English</span></div>
              <div className="flex min-h-12 items-center gap-4 px-4 text-sm text-muted-foreground" title="Hotel search lets you select a quote currency"><Coins className="size-4 shrink-0" />Currency <span className="ml-auto text-foreground">INR</span></div>
              <Link to="/contact" onClick={close} className="flex min-h-12 items-center gap-4 border-l-2 border-transparent px-4 text-sm font-medium hover:border-gold hover:bg-secondary"><MessageSquare className="size-4 shrink-0 text-gold" />Feedback</Link>
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link to="/" aria-label="Fly n Feel Holidays — Home" className="shrink-0"><img src={logo} alt="Fly n Feel Holidays" width={560} height={200} loading="eager" decoding="async" className="h-12 w-auto sm:h-14 md:h-16 lg:h-[72px]" /></Link>
          <Link to="/assistant" className="hidden items-center gap-2 whitespace-nowrap text-xs font-semibold uppercase text-foreground transition-colors hover:text-gold sm:inline-flex"><Bot className="size-4 text-gold" />Ask AI</Link>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <Link to="/assistant" aria-label="Ask AI" className="grid size-9 place-items-center text-foreground hover:text-gold sm:hidden"><Bot className="size-5" /></Link>
          <Button asChild className="hidden bg-gold text-primary-foreground hover:bg-primary sm:inline-flex"><Link to="/contact">Plan a Journey</Link></Button>
          <Button asChild variant="ghost" size="icon" className="size-9 border border-foreground/15 text-gold hover:text-gold sm:hidden"><Link to="/contact" aria-label="Plan a Journey" title="Plan a Journey"><ArrowUpRight className="size-5" /></Link></Button>
          <Link to={isAuthenticated ? "/account" : "/auth/login"} aria-label={isAuthenticated ? "My account" : "Sign in or sign up"} className="grid size-10 shrink-0 place-items-center border border-foreground/15 text-foreground transition-colors hover:border-gold hover:text-gold"><UserRound className="size-5" /></Link>
        </div>
      </nav>
    </header>
  );
}
