import type { Metadata } from 'next';
import { HomeScreen } from '@/components/screens/HomeScreen';

export const metadata: Metadata = { title: 'Home', description: 'Pick what you want to do: get ready for a visit, practice it, or remember what was said.' };

export default function Page() {
  return <HomeScreen />;
}
