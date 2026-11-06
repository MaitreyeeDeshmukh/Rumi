import { ShareScreen } from "@/components/screens/ShareScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/share");

export default function Page() {
  return <ShareScreen />;
}
