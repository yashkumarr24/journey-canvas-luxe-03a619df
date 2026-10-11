import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bot, CircleHelp, Mail, UserRound } from "lucide-react";
import logo from "@/assets/flynfeel-logo.webp";
import { useAuth } from "@/lib/auth/auth-context";
import { AssistantDrawer } from "@/components/assistant/AssistantDrawer";
import { AssistantWelcomePopup } from "@/components/assistant/AssistantWelcomePopup";

export function Nav() {
  const [aiOpen, setAiOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const openAi = () => setAiOpen(true);

  return (
    <header className="fixed inset-x-0 top-0 z-[60] px-3 pt-3 sm:px-6 sm:pt-4">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 rounded-full border border-foreground/10 bg-background/95 pl-4 pr-2 shadow-[var(--shadow-soft)] backdrop-blur-md sm:h-16 sm:gap-4 sm:pl-6 sm:pr-3"
      >
        <Link to="/" aria-label="Fly n Feel Holidays — Home" className="shrink-0">
          <img
            src={logo}
            alt="Fly n Feel Holidays"
            width={560}
            height={200}
            loading="eager"
            decoding="async"
            className="h-10 w-auto sm:h-12"
          />
        </Link>

        <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={openAi}
            aria-label="Open Ask AI travel assistant"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-secondary hover:text-gold"
          >
            <Bot className="size-4 shrink-0 text-gold" aria-hidden="true" />
            <span className="hidden sm:inline">Ask AI</span>
          </button>

          <Link
            to="/contact"
            aria-label="Help and support"
            className="hidden items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-secondary hover:text-gold md:inline-flex"
          >
            <CircleHelp className="size-4 shrink-0 text-gold" aria-hidden="true" />
            Help &amp; Support
          </Link>

          <Link
            to="/contact"
            aria-label="Contact us"
            title="Contact us"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-foreground/15 text-foreground transition-colors hover:border-gold hover:text-gold sm:size-10"
          >
            <Mail className="size-4 sm:size-5" aria-hidden="true" />
          </Link>

          <Link
            to={isAuthenticated ? "/account" : "/auth/login"}
            aria-label={isAuthenticated ? "My account" : "Sign in or sign up"}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary-foreground shadow-[var(--shadow-card)] transition-all duration-300 hover:-translate-y-px hover:bg-primary hover:shadow-[var(--shadow-luxe)] sm:px-5"
          >
            <UserRound className="size-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">{isAuthenticated ? "My Account" : "Login / Sign Up"}</span>
          </Link>
        </div>
      </nav>

      <AssistantDrawer open={aiOpen} onOpenChange={setAiOpen} />
      {!aiOpen && <AssistantWelcomePopup onOpenChat={openAi} />}
    </header>
  );
}
