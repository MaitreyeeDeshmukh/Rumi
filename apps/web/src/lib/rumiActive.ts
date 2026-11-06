"use client";

// The one place the app picks its state: the real state lane. Screens import useRumi, RumiProvider and ThemeSync from here.
export { useRumi, RumiProvider } from "@/features/state/RumiProvider";
export { ThemeSync } from "@/components/ThemeSync";
