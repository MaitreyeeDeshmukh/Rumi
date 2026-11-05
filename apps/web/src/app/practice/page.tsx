import type { Metadata } from 'next';
import { PracticeScreen } from '@/components/screens/PracticeScreen';

export const metadata: Metadata = { title: 'Practice', description: 'Practice your visit with a practice clinician. Ask for help when you are stuck.' };

export default function Page() {
  return <PracticeScreen />;
}
