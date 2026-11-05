import type { Metadata } from 'next';
import { SayItScreen } from '@/components/screens/SayItScreen';

export const metadata: Metadata = { title: 'Say it', description: 'Pick what you need to say, like booking a visit or asking for written steps. Rumi writes a short script.' };

export default function Page() {
  return <SayItScreen />;
}
