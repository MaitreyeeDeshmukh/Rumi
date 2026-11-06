import { SayItScreen } from "@/components/screens/SayItScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/say-it");

export default function Page() {
  return <SayItScreen />;
}
