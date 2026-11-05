import type { Focus, VisitPlan, PlanItem } from '../shared/types';
export const FOCUS_LABEL: Record<Focus, string> = { problem: 'Explain my problem', questions: 'Ask my questions', needs: 'Ask for what I need', next_steps: 'Understand what to do next', whole: 'The whole visit' };
export const enabledItems = (p: VisitPlan) => p.items.filter((i) => i.enabled).map((i, n) => ({ label: `q${n + 1}`, id: i.id, text: i.text }));
export const itemsForFocus = (p: VisitPlan, f: Focus): PlanItem[] => p.items.filter((i) => i.enabled &&
  (f === 'problem' ? i.kind === 'concern' : f === 'questions' || f === 'next_steps' ? i.kind === 'question' : f === 'needs' ? i.kind === 'accommodation' : true));
