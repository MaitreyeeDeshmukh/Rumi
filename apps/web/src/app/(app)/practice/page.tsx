import { PracticeScreen } from "@/components/screens/PracticeScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/practice");

export default function Page() {
  return <PracticeScreen />;
}
