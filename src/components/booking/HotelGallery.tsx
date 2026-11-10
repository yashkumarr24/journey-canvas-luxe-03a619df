import { useState } from "react";
import { Images } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { HotelImage } from "@/types/booking";

/**
 * Compact hotel gallery: one prominent photo beside a neat grid of smaller
 * thumbnails (desktop) or a main photo with a short thumbnail row (mobile).
 * When there are more photos than the grid shows, the last tile carries a
 * "+N photos" control that opens the full set in a dialog.
 */

const VISIBLE_DESKTOP = 5; // 1 main + 4 thumbnails
const VISIBLE_MOBILE = 4; // 1 main + 3 thumbnails

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

  const extraCount = list.length - VISIBLE_DESKTOP;

  const thumbButton = (image: HotelImage, index: number, isLastVisible: boolean) => {
    const showMore = isLastVisible && extraCount > 0;
    return (
      <button
        key={`${image.url}-${index}`}
        type="button"
        aria-label={showMore ? `View all ${list.length} photos` : (image.caption ?? `Photo ${index + 1}`)}
        aria-current={!showMore && index === active}
        onClick={() => setActive(index)}
        className={`relative block size-full overflow-hidden rounded-xl border transition-opacity ${
          index === active && !showMore ? "border-gold" : "border-foreground/10 opacity-80 hover:opacity-100"
        }`}
      >
        <img src={image.url} alt="" loading="lazy" className="aspect-[4/3] size-full object-cover" />
        {showMore && (
          <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-primary/70 text-sm font-medium text-primary-foreground">
            <Images className="size-4" aria-hidden="true" /> +{extraCount}
          </span>
        )}
      </button>
    );
  };

  const grid = (visible: number) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
      <div className="col-span-2 sm:row-span-2">
        <img
          src={current.url}
          alt={current.caption ?? name}
          className="aspect-[4/3] size-full rounded-xl border border-foreground/10 object-cover sm:aspect-auto sm:h-full"
        />
      </div>
      {list.slice(1, visible).map((image, i) => thumbButton(image, i + 1, i + 1 === visible - 1 && list.length > visible))}
      {list.length > visible && (
        <AllPhotosTrigger list={list} name={name} onPick={setActive} />
      )}
    </div>
  );

  return (
    <div>
      {/* Mobile: main photo + compact row */}
      <div className="sm:hidden">{grid(VISIBLE_MOBILE)}</div>
      {/* Desktop: main photo beside a 2x2 thumbnail grid */}
      <div className="hidden sm:block">{grid(VISIBLE_DESKTOP)}</div>
    </div>
  );
}

function AllPhotosTrigger({
  list,
  name,
  onPick,
}: {
  list: HotelImage[];
  name: string;
  onPick: (index: number) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex aspect-[4/3] size-full items-center justify-center gap-1.5 rounded-xl border border-foreground/10 bg-card text-sm font-medium text-foreground transition-colors hover:border-gold hover:text-gold"
        >
          <Images className="size-4" aria-hidden="true" /> View all {list.length} photos
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
