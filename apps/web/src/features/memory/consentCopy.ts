/**
 * The words for the memory switch and the delete button. One place, so the screen and the privacy page say the same
 * true thing: only the id of each choice is saved, in Rumi's own database, and it can be deleted at any time.
 * Every sentence has at most 15 words.
 */
export const MEMORY_COPY = {
  title: 'Let Rumi remember how I like to be supported',
  body: [
    'Rumi can save short choices you made, like "Please speak slowly."',
    'It also saves how much help you needed.',
    'Then you do not start over each time.',
    'This is off. If you turn it on, only the id of each choice is saved.',
    'It is saved in Rumi\u2019s own database, not with another company.',
    'Rumi does not save your health details or your name.',
    'It does not save what you write in your plan.',
    'You can delete everything at any time.',
  ],
  toggle: 'Remember my support sentences',
  saved: 'Saved.',
  paused: 'Saving is paused. Your work is on this device.',
  failed: 'I could not save this. Try again.',
  forgetButton: 'Forget everything',
  forgetConfirm: 'Delete all remembered choices from Rumi?',
  forgetFailed: 'I could not delete them yet. Try again.',
} as const;
