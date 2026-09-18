/**
 * Customer document area.
 *
 * When the backend supplies a real URL the row becomes a download link. Until
 * then it shows an honest placeholder — no fake ticket, voucher or invoice is
 * ever generated in the browser.
 */

import { Download, FileText } from "lucide-react";

import type { BookingDocument } from "@/types/operations";

export function DocumentsPanel({ documents }: { documents: BookingDocument[] }) {
  return (
    <ul className="space-y-3">
      {documents.map((document) => (
        <li
          key={document.kind}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background/60 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FileText className="size-4 text-gold" aria-hidden />
              {document.label}
            </p>
            {document.note ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{document.note}</p>
            ) : null}
          </div>
          {document.url ? (
            <a
              href={document.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-foreground/15 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-foreground/5"
            >
              <Download className="size-3.5" aria-hidden />
              Download
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">
              {document.status === "pending" ? "Not available yet" : "Not applicable"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
