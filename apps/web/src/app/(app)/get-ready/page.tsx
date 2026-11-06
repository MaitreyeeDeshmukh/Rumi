import { GetReadyScreen } from "@/components/screens/GetReadyScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/get-ready");

export default function Page() {
  return <GetReadyScreen />;
}
