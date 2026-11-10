import { useState } from "react";
import { Images } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { HotelImage } from "@/types/booking";

/**
 * Compact hotel gallery: one prominent photo beside a neat grid of smaller
 * thumbnails (desktop) or a main photo with a short thumbnail row (mobile).
 * When there are more photos than the grid shows, a "View all photos" tile
 * opens the full set in a dialog.
 */

export function HotelGallery({ images, name }: { images?: HotelImage[]; name: string }) {
  const list = images ?? [];
  const [open, setOpen] = useState(false);

  if (list.length === 0) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-2xl border border-dashed border-foreground/15 text-sm text-muted-foreground">
        No photos available for this property yet
      </div>
    );
  }

  /** Big photo on the left, two stacked photos on the right; the last one opens all photos. */
  const side = list.slice(1, 3);
  const extra = list.length - 3;

  return (
    <div className="grid grid-cols-3 gap-2 sm:h-[340px] sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] sm:grid-rows-2">
      <button type="button" aria-label="Open all photos" onClick={() => setOpen(true)} className="col-span-3 overflow-hidden rounded-xl sm:col-span-1 sm:row-span-2">
        <img src={list[0].url} alt={list[0].caption ?? name} className="aspect-[16/10] size-full object-cover sm:aspect-auto" />
      </button>
      {side.map((image, i) => (
        <button key={`${image.url}-${i}`} type="button" aria-label={i === side.length - 1 && extra > 0 ? `View all ${list.length} photos` : image.caption ?? `Photo ${i + 2}`} onClick={() => setOpen(true)} className="relative overflow-hidden rounded-xl">
          <img src={image.url} alt="" loading="lazy" className="aspect-[4/3] size-full object-cover sm:aspect-auto" />
          {i === side.length - 1 && extra > 0 && (
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-foreground/75 px-2 py-1 text-xs font-medium text-background">
              <Images className="size-3.5" aria-hidden="true" />+{extra} photos
            </span>
          )}
        </button>
      ))}
      <AllPhotos list={list} name={name} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function AllPhotos({ list, name, open, onOpenChange }: { list: HotelImage[]; name: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{name} — {list.length} photos</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((image, index) => (
            <img key={`${image.url}-all-${index}`} src={image.url} alt={image.caption ?? `Photo ${index + 1}`} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
