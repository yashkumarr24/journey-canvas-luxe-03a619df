import { useState } from "react";
import type { HotelImage } from "@/types/booking";

/**
 * Hotel image gallery. Images arrive from the server response, so a property
 * with no photos degrades to a labelled placeholder rather than a broken frame.
 */

export function HotelGallery({ images, name }: { images?: HotelImage[]; name: string }) {
  const list = images ?? [];
  const [active, setActive] = useState(0);
  const current = list[Math.min(active, Math.max(list.length - 1, 0))];

  if (list.length === 0) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-3xl border border-dashed border-foreground/15 text-sm text-muted-foreground">
        No photos available for this property yet
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-3xl border border-foreground/10">
        <img
          src={current.url}
          alt={current.caption ?? name}
          className="aspect-[16/9] w-full object-cover"
        />
      </div>

      {list.length > 1 && (
        <div className="mt-3 grid grid-cols-4 gap-3">
          {list.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              aria-label={image.caption ?? `Photo ${index + 1}`}
              aria-current={index === active}
              onClick={() => setActive(index)}
              className={`overflow-hidden rounded-2xl border transition-opacity ${
                index === active ? "border-gold" : "border-foreground/10 opacity-70 hover:opacity-100"
              }`}
            >
              <img
                src={image.url}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
