import { Suspense } from "react";
import { RecordScreen } from "@/components/screens/RecordScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/record");

// useSearchParams needs a Suspense boundary so the page can still be built ahead of time.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <RecordScreen />
    </Suspense>
  );
}
