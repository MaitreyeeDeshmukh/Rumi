import type { Metadata } from 'next';
import { SettingsScreen } from '@/components/screens/SettingsScreen';

export const metadata: Metadata = { title: 'Settings', description: 'Change how Rumi looks and reads, see what is stored on this device, and delete everything.' };

export default function Page() {
  return <SettingsScreen />;
}
