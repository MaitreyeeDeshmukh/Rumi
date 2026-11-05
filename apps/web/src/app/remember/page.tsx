import type { Metadata } from 'next';
import { RememberScreen } from '@/components/screens/RememberScreen';

export const metadata: Metadata = { title: 'Remember', description: 'See what was said in a sample visit, with each line of the summary linked to the text.' };

export default function Page() {
  return <RememberScreen />;
}
