import { KitScreen } from "@/components/screens/KitScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/kit");

export default function Page() {
  return <KitScreen />;
}
