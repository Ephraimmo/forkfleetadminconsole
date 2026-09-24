import { cn } from "@/lib/utils";

/*
 * Hearth brand mark — shared across the customer app, Hearth Admin and Hearth Kitchen.
 * Copy of the customer app's `src/components/app/logo.tsx`. The path below is the
 * canonical flame: never redraw it. The second subpath is the hole and relies on
 * fill-rule="evenodd". Keep in sync with public/*.svg and src/lib/error-page.ts.
 */
export const HEARTH_FLAME_PATH =
  "M16 4C20.5 10 25 13.5 25 19A9 9 0 0 1 7 19C7 13.5 11.5 10 16 4ZM16 13C18 16 20 17.8 20 20.5A4 4 0 0 1 12 20.5C12 17.8 14 16 16 13Z";

/** Flame alone, coloured by `currentColor`. Decorative — label the surrounding link. */
export function HearthMark({ className }: { className?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
    >
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={HEARTH_FLAME_PATH} />
    </svg>
  );
}

/** Cream flame in a filled orange tile — the app-icon lockup (flame at 0.78, rx 7/32). */
export function HearthBadge({ className }: { className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[22%] bg-primary text-primary-foreground",
        className,
      )}
    >
      <HearthMark className="size-[78%]" />
    </span>
  );
}

/** Mark + wordmark. The wordmark stays real text so it is selectable and announced once. */
export function HearthLogo({
  product,
  className,
  markClassName,
}: {
  product?: string | undefined;
  className?: string | undefined;
  markClassName?: string | undefined;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <HearthBadge className={markClassName} />
      <span className="font-wordmark text-lg font-black leading-none tracking-[-0.02em] text-foreground">
        Hearth
        {product && (
          <span className="ml-1.5 font-sans font-semibold tracking-normal text-muted-foreground">
            {product}
          </span>
        )}
      </span>
    </span>
  );
}
