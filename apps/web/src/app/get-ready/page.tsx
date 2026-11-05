import type { Metadata } from 'next';
import { GetReadyScreen } from '@/components/screens/GetReadyScreen';

export const metadata: Metadata = { title: 'Get ready', description: 'Say what you want to talk about at your visit. Rumi turns it into a plan you can change.' };

export default function Page() {
  return <GetReadyScreen />;
}
