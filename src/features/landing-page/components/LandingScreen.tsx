import type { ReactNode } from "react";

/** One full-height snap screen: the same top gap under the fixed header, the same gap between copy and card. */
export function LandingScreen({ children }: { children: ReactNode }) {
  return (
    <section className="relative isolate flex h-[100dvh] flex-col snap-start snap-always">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col items-center gap-7 px-4 pb-7 pt-[92px] sm:px-8">
        {children}
      </div>
    </section>
  );
}
