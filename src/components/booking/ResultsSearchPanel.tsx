import { useId, useState, type ReactNode } from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ResultsSearchPanel({ title, detail, active, children }: { title: string; detail: string; active: boolean; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const id = useId();
  return (
    <div className={active ? "border-b border-border pb-4 lg:pb-6" : "mt-8 border-b border-border pb-6"}>
      {active && <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border border-border bg-card p-3 lg:hidden">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{title}</p><p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p></div>
        <Button type="button" variant="ghost" size="icon" aria-label={editing ? "Close search editor" : "Edit search"} aria-expanded={editing} aria-controls={id} onClick={() => setEditing((value) => !value)}>
          {editing ? <X className="size-4" aria-hidden="true" /> : <Pencil className="size-4" aria-hidden="true" />}
        </Button>
      </div>}
      <div id={id} className={active ? `${editing ? "mt-4" : "hidden"} lg:mt-0 lg:block` : ""}>{children}</div>
    </div>
  );
}