"use client";
import { Children, useCallback, useEffect, useRef, useState } from "react";
import { cn, focusRing } from "./utils";

/**
 * Carousel on native CSS scroll-snap: swipe on touch, trackpad, keyboard arrows, buttons and dots.
 * Each child is a slide. Control slides per view with `slideClassName`, e.g. "basis-full sm:basis-1/2 lg:basis-1/3".
 * <Carousel autoPlay={5000} loop>{images.map((src) => <img key={src} src={src} className="h-64 w-full object-cover" alt="" />)}</Carousel>
 */
export function Carousel({
  children,
  autoPlay = 0,
  loop = false,
  showArrows = true,
  showDots = true,
  slideClassName = "basis-full",
  gap = "gap-4",
  className,
  label = "Carrusel",
}) {
  const track = useRef(null);
  const slides = Children.toArray(children);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: slides.length <= 1 });

  const scrollTo = useCallback(
    (i) => {
      const el = track.current;
      if (!el) return;
      const count = el.children.length;
      const target = loop ? (i + count) % count : Math.max(0, Math.min(count - 1, i));
      const child = el.children[target];
      if (child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: "smooth" });
    },
    [loop]
  );

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const children = [...el.children];
    let closest = 0;
    let best = Infinity;
    children.forEach((c, i) => {
      const d = Math.abs(c.offsetLeft - el.offsetLeft - el.scrollLeft);
      if (d < best) {
        best = d;
        closest = i;
      }
    });
    setIndex(closest);
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    onScroll();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onScroll, slides.length]);

  useEffect(() => {
    if (!autoPlay || paused || slides.length <= 1) return;
    const t = setInterval(() => {
      if (edges.end) scrollTo(loop ? 0 : index);
      else scrollTo(index + 1);
    }, autoPlay);
    return () => clearInterval(t);
  }, [autoPlay, paused, index, edges.end, loop, scrollTo, slides.length]);

  const arrow = "absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-surface/90 p-2 text-fg shadow backdrop-blur transition-opacity hover:bg-surface disabled:opacity-0";

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className={cn("relative", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        ref={track}
        onScroll={onScroll}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); scrollTo(index + 1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); scrollTo(index - 1); }
        }}
        className={cn("flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", gap, focusRing)}
      >
        {slides.map((slide, i) => (
          <div key={i} role="group" aria-roledescription="slide" aria-label={`${i + 1} de ${slides.length}`} className={cn("shrink-0 snap-start", slideClassName)}>
            {slide}
          </div>
        ))}
      </div>

      {showArrows && slides.length > 1 && (
        <>
          <button type="button" aria-label="Anterior" onClick={() => scrollTo(index - 1)} disabled={!loop && edges.start} className={cn(arrow, "left-2")}>
            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.8 5.2a.75.75 0 0 1 0 1.06L9.06 10l3.74 3.74a.75.75 0 1 1-1.06 1.06l-4.27-4.27a.75.75 0 0 1 0-1.06L11.74 5.2a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
          </button>
          <button type="button" aria-label="Siguiente" onClick={() => scrollTo(edges.end && loop ? 0 : index + 1)} disabled={!loop && edges.end} className={cn(arrow, "right-2")}>
            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06L8.26 14.8a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" /></svg>
          </button>
        </>
      )}

      {showDots && slides.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ir al slide ${i + 1}`}
              aria-current={i === index}
              onClick={() => scrollTo(i)}
              className={cn("h-2 rounded-full transition-all", i === index ? "w-6 bg-primary" : "w-2 bg-border hover:bg-muted")}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default Carousel;
