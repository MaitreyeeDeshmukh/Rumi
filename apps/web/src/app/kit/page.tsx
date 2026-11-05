import type { Metadata } from 'next';
import { KitScreen } from '@/components/screens/KitScreen';

export const metadata: Metadata = { title: 'Visit kit', description: 'Your plan and support card in one place, ready to copy or print for your visit.' };

export default function Page() {
  return <KitScreen />;
}
