"use client";

import { Banner, Button } from "@/components/ui";

export default function AuthError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Banner tone="cost" action={<Button onClick={reset}>Try again</Button>}>
      Something went wrong. Nothing has been changed; try again.
    </Banner>
  );
}
