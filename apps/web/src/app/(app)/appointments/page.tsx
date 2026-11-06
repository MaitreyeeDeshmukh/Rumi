import { AppointmentsScreen } from "@/components/screens/AppointmentsScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/appointments");

export default function Page() {
  return <AppointmentsScreen />;
}
