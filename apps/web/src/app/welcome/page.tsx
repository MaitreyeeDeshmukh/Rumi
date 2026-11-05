import type { Metadata } from 'next';
import { WelcomeScreen } from '@/components/screens/WelcomeScreen';

export const metadata: Metadata = { title: 'Welcome', description: 'Four quick questions to set up Rumi: your name, your helper, how you read, and how it looks.' };

export default function Page() {
  return <WelcomeScreen />;
}
