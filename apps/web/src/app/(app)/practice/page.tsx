import { Suspense } from "react";
import { PracticeScreen } from "@/components/screens/PracticeScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/practice");

// useSearchParams needs a Suspense boundary so the page can still be built ahead of time.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <PracticeScreen />
    </Suspense>
  );
}
