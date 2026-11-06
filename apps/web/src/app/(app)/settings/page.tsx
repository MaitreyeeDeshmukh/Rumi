import { SettingsScreen } from "@/components/screens/SettingsScreen";
import { metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/settings");

export default function Page() {
  return <SettingsScreen />;
}
