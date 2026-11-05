import type { Metadata } from 'next';
import { ShareScreen } from '@/components/screens/ShareScreen';

export const metadata: Metadata = { title: 'Share', description: 'Choose what to share and see the exact text before you copy it. Rumi does not send anything.' };

export default function Page() {
  return <ShareScreen />;
}
