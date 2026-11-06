import { WelcomeScreen } from "@/components/screens/WelcomeScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/welcome");

export default function Page() {
  return <WelcomeScreen />;
}
