import { Suspense } from "react";
import { RememberScreen } from "@/components/screens/RememberScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/remember");

// useSearchParams (the ?visit= link from Record) needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <RememberScreen />
    </Suspense>
  );
}
