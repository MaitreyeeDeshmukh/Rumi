import { NewAppointmentScreen } from "@/components/screens/NewAppointmentScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/appointments/new");

export default function Page() {
  return <NewAppointmentScreen />;
}
