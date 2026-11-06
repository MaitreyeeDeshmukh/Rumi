"use client";

// The one place the app picks its state implementation. To use the real state lane, point these three lines at it:
//   useRumi -> @/features/state/useRumi, RumiProvider -> @/features/state/RumiProvider, ThemeSync -> its ThemeSync.
// Components import useRumi from here, never from the shim. Not on this list, and bound to the shim: ThemeSync
// (replace the file with the lane's), and features/home/useDashboardInput.ts, features/shims/*, which import shim
// helpers (startLevelFor, summarizeSession, types) directly. The shim's useRumi also reads the first-paint look
// (appliedLook); the lane's provider must keep that, or a dark-system person gets Soft Focus applied over Low Light.
export { useRumi } from "@/features/shims/useRumi.shim";
export { RumiShimProvider as RumiProvider } from "@/features/shims/RumiShimProvider";
export { ThemeSync } from "@/components/ThemeSync";
