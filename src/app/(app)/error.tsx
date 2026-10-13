"use client";

import { Banner, Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <Banner tone="cost" action={<Button onClick={reset}>Try again</Button>}>
      This page could not be loaded. Nothing has been lost; try again.
    </Banner>
  );
}
