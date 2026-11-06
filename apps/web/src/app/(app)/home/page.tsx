import { HomeScreen } from "@/components/screens/HomeScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/home");

export default function Page() {
  return <HomeScreen />;
}
