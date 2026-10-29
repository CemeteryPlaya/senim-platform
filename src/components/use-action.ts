"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";

export function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result && result.error) setError(result.error);
      else onSuccess?.();
    });
  }

  return { pending, error, run, setError };
}
