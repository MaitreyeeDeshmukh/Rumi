export const PLAN_VERSION = 'plan@2';
export const PLAN_TASK = `Make a visit plan from the wrapped rawText data.
Copy mainConcern as an exact phrase from the user's words, without adding facts.
List only exact symptom or fact phrases in symptomsInMyWords. Use [] if uncertain.
User-source items must be exact excerpts, not paraphrases or inferred questions.
Classify them as concern, question, or accommodation. Preserve requests for support.
Do not correct the user's communication style or interpret what they meant.
Add at most two optional suggested items, using ONLY these exact sentences:
- I want to ask what I should do next.
- I want to ask if I can have instructions in writing.
- Please give me instructions in writing.
- Please give me time to answer.
- Please ask one question at a time.
Suggested items are choices, not instructions the user must follow.
Return JSON: {mainConcern, symptomsInMyWords: [], items: [{text, kind, source}], crisis}.`;
