// IntersectionObserver wiring for `useInfiniteQuery`. Attach the returned
// callback ref to a sentinel element below the last row; when it scrolls into
// view, fetchNextPage is called.
//
// `enabled` is just `hasNextPage && !isFetchingNextPage` — pass it to gate
// observation so we don't spam the observer when there's nothing to load.

import { useCallback, useEffect, useRef } from "react";

export function useInfiniteScroll(
  fetchNextPage: () => unknown,
  enabled: boolean,
): (el: HTMLElement | null) => void {
  const fnRef = useRef(fetchNextPage);
  fnRef.current = fetchNextPage;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const ioRef = useRef<IntersectionObserver | null>(null);
  const elRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      if (ioRef.current) {
        ioRef.current.disconnect();
        ioRef.current = null;
      }
    };
  }, []);

  return useCallback((el: HTMLElement | null) => {
    if (elRef.current && ioRef.current) {
      ioRef.current.unobserve(elRef.current);
    }
    elRef.current = el;
    if (!el) return;
    if (!ioRef.current) {
      ioRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && enabledRef.current) {
              fnRef.current();
            }
          }
        },
        { rootMargin: "200px" },
      );
    }
    ioRef.current.observe(el);
  }, []);
}
