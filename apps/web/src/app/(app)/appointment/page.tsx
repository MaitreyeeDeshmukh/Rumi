import { Suspense } from "react";
import { AppointmentScreen } from "@/components/screens/AppointmentScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/appointment");

// useSearchParams needs a Suspense boundary so the page can still be built ahead of time.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <AppointmentScreen />
    </Suspense>
  );
}
