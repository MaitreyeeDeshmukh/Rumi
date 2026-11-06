"use client";

import { useFocusH1OnNavigation } from "@/hooks/useFocusH1OnNavigation";

/** Rendered once by each layout so it survives page remounts. */
export function FocusOnNavigate(): null {
  useFocusH1OnNavigation();
  return null;
}
