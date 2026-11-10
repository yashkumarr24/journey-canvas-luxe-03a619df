import { useState } from "react";
import { Images } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { HotelImage } from "@/types/booking";

/**
 * Compact hotel gallery: one prominent photo beside a neat grid of smaller
 * thumbnails (desktop) or a main photo with a short thumbnail row (mobile).
 * When there are more photos than the grid shows, a "View all photos" tile
 * opens the full set in a dialog.
 */

export function HotelGallery({ images, name }: { images?: HotelImage[]; name: string }) {
  const list = images ?? [];
  const [active, setActive] = useState(0);
  const current = list[Math.min(active, Math.max(list.length - 1, 0))];

  if (list.length === 0) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-2xl border border-dashed border-foreground/15 text-sm text-muted-foreground">
        No photos available for this property yet
      </div>
    );
  }

  /**
   * Desktop: 4-column grid, main photo spans 2x2, leaving a 2x2 area for
   * thumbnails + the "view all" tile. Mobile: 2-column grid, main photo spans
   * the full row, one thumbnail row below.
   */
  const desktopThumbs = list.slice(1, 4);
  const mobileThumbs = list.slice(1, 2);
  const hasMore = list.length > 4;

  const thumb = (image: HotelImage, index: number) => (
    <button
      key={`${image.url}-${index}`}
      type="button"
      aria-label={image.caption ?? `Photo ${index + 1}`}
      aria-current={index === active}
      onClick={() => setActive(index)}
      className={`block size-full overflow-hidden rounded-xl border transition-opacity ${
        index === active ? "border-gold" : "border-foreground/10 opacity-80 hover:opacity-100"
      }`}
    >
      <img src={image.url} alt="" loading="lazy" className="aspect-[4/3] size-full object-cover" />
    </button>
  );

  const viewAll = <AllPhotosTile list={list} name={name} onPick={setActive} />;

  return (
    <div>
      {/* Mobile: main photo + one compact thumbnail row */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <div className="col-span-2">
          <img
            src={current.url}
            alt={current.caption ?? name}
            className="aspect-[4/3] size-full rounded-xl border border-foreground/10 object-cover"
          />
        </div>
        {mobileThumbs.map((image, i) => thumb(image, i + 1))}
        {list.length > 2 && viewAll}
      </div>

      {/* Desktop: prominent photo beside a 2x2 thumbnail grid */}
      <div className="hidden grid-cols-4 gap-3 sm:grid">
        <div className="col-span-2 row-span-2">
          <img
            src={current.url}
            alt={current.caption ?? name}
            className="size-full rounded-xl border border-foreground/10 object-cover"
          />
        </div>
        {desktopThumbs.map((image, i) => thumb(image, i + 1))}
        {hasMore ? viewAll : list.length > 1 && list.length <= 4 ? null : null}
      </div>
    </div>
  );
}

function AllPhotosTile({
  list,
  name,
  onPick,
}: {
  list: HotelImage[];
  name: string;
  onPick: (index: number) => void;
}) {
  const extra = list.length - 4;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex aspect-[4/3] size-full flex-col items-center justify-center gap-1.5 rounded-xl border border-foreground/10 bg-card text-sm font-medium text-foreground transition-colors hover:border-gold hover:text-gold sm:aspect-auto"
        >
          <Images className="size-4" aria-hidden="true" />
          {extra > 0 ? `+${extra} photos` : "View all photos"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{name} — all photos</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((image, index) => (
            <button
              key={`${image.url}-all-${index}`}
              type="button"
              aria-label={image.caption ?? `Photo ${index + 1}`}
              onClick={() => onPick(index)}
              className="overflow-hidden rounded-xl border border-foreground/10 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <img src={image.url} alt="" loading="lazy" className="aspect-[4/3] size-full object-cover" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
