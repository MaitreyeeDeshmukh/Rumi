import type { z } from 'zod';
import type { SayItRequest, SayItReply } from '../shared/schemas';
import { blanksFrom } from './newFacts';
const SCENARIOS = {
  book: ['What day works for you? You can start with: I would like...', 'I would like to book an appointment on [day].', 'I would like help booking an appointment.'],
  late: ['What do you want the clinic to know? You can start with: I am...', 'I am running late for my appointment at [time].', 'I am running late. Can I still come to my appointment?'],
  repeat: ['What would you like repeated? You can start with: Please repeat...', 'Please repeat [the part I missed].', 'Please say that again slowly.'],
  written: ['What would you like in writing? You can start with: Please write...', 'Please write down [what I need to remember].', 'Please give me the instructions in writing.'],
  next: ['What would you like explained? You can start with: What happens...', 'What should I do after [the part I understood]?', 'Please explain the next step.'],
};
export function mockSayIt(r: z.infer<typeof SayItRequest>): z.infer<typeof SayItReply> {
  const script = r.scenario ? SCENARIOS[r.scenario][r.level - 1] : r.level === 1
    ? 'What would you like to say? You can start with: I want to explain...'
    : r.level === 2 ? 'I want to explain [my concern].' : 'I am not sure how to explain. Please give me time.';
  return { script, blanks: blanksFrom(script) };
}
