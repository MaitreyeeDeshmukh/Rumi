import { RememberScreen } from "@/components/screens/RememberScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/remember");

export default function Page() {
  return <RememberScreen />;
}
