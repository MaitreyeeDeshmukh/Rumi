// Title, h1, lead, description and primary action of every route (spec section 4.8).
// All 17 routes of the table, plus the not-found and error pages below. Tasks 10 to 15 build the app pages that
// already have their text here. tests/unit/copy.test.ts lints every string (15 words per sentence, 30 for a description).
import type { PageMeta } from "@/lib/pages";

export const PAGES_COPY = {
  "/": {
    title: "Rumi: a calm helper for your doctor visits",
    navTitle: "the home page",
    h1: "A calm helper for your doctor visits.",
    lead: "Rumi helps you get ready, practice, and remember a visit. You speak for yourself.",
    description:
      "Rumi helps autistic and ADHD adults get ready for a doctor visit, practice what to say, and remember what was said. Try it in your browser.",
    primary: "Open Rumi",
  },
  "/how-it-works": {
    title: "How Rumi works",
    h1: "How Rumi works.",
    lead: "Three steps. You choose each one.",
    description:
      "See the three steps in Rumi: get ready with a plan, practice with a pretend clinician, and remember a visit with proof from the text.",
    primary: "Open Rumi",
  },
  "/about": {
    title: "About Rumi",
    h1: "About Rumi.",
    lead: "Why we built Rumi, what we have tested, and what we have not.",
    description: "Why Rumi exists, who built it, what has been tested, what has not, and how Rumi uses an AI service.",
    primary: "Open Rumi",
  },
  "/contact": {
    title: "Contact",
    h1: "Contact us.",
    lead: "Questions, feedback, or a problem with Rumi? Write to us.",
    description:
      "Send a question, feedback, or a request to work with the Rumi team. Your email app opens with your message ready.",
    primary: "Open in my email app",
  },
  "/help": {
    title: "Help",
    h1: "Help.",
    lead: "Answers to common questions about Rumi.",
    description: "Answers about how Rumi works, what it saves, voice typing, and what to do in a crisis.",
    primary: "Contact us",
  },
  "/safety": {
    title: "Safety and crisis help",
    h1: "Safety and crisis help.",
    lead: "If you are in danger, get help now.",
    description:
      "What to do if you are in danger, and what Rumi will and will not do. Call or text 988, or call 911 in the US.",
    primary: "Call 988",
  },
  "/privacy": {
    title: "Privacy",
    h1: "Privacy.",
    lead: "Here is what Rumi does with your information.",
    description:
      "Exactly what Rumi keeps on your device, what is sent when you press a button, and what Rumi never does with your data.",
    primary: "Open Rumi",
  },
  "/accessibility": {
    title: "Accessibility",
    h1: "Accessibility.",
    lead: "How Rumi works for different people, and where it does not yet.",
    description:
      "What Rumi supports for accessibility: themes, text size, reduced motion, keyboard use, and screen readers, plus known gaps.",
    primary: "Report a problem",
  },
  "/welcome": {
    title: "Welcome",
    h1: "Welcome to Rumi.",
    lead: "Four quick questions. You can skip all of them.",
    description: "Set your name, how you like to read, and how Rumi looks. Every question is optional.",
    primary: "Start",
  },
  "/home": {
    title: "Home",
    h1: "Hi.",
    lead: "Here is where you are.",
    description: "See your three steps, what to do next, your last practice, and your visit kit.",
    // The label comes from nextStep() (Task 10).
    primary: null,
  },
  "/get-ready": {
    title: "Get ready",
    h1: "Get ready.",
    lead: "Say what you want to talk about. Rumi makes a plan.",
    description: "Say what you want to talk about at your visit. Rumi turns it into a plan you can change.",
    primary: { empty: "Make my plan", plan: "Looks right", saved: "Go to Practice" },
  },
  "/practice": {
    title: "Practice",
    h1: "Practice.",
    lead: "What part do you want to practice?",
    description:
      "Practice a doctor visit with a pretend clinician. Ask for help when you are stuck. This is not a real doctor.",
    primary: {
      noPlan: "Go to Get ready",
      picker: "Start practice",
      call: "Send",
      paused: "Resume",
      summary: "Practice again",
    },
  },
  "/remember": {
    title: "Remember",
    h1: "Remember.",
    lead: "See what Rumi can do with a visit. This one is a made-up example.",
    description:
      "See a summary of a made-up visit, with proof from the text for each point and what you said yourself.",
    primary: { intro: "Use the sample visit", picker: "This voice is me", recap: "Go to Share" },
  },
  "/share": {
    title: "Share",
    h1: "Share.",
    lead: "Choose what to share. You see the exact text before you copy it.",
    description:
      "Pick what to share. You see the exact text first. Rumi sends nothing. You copy it yourself.",
    primary: "Copy text",
  },
  "/kit": {
    title: "Visit kit",
    h1: "Your kit is ready.",
    lead: "Take this to your visit.",
    empty: { h1: "Your kit.", lead: "Your kit needs a plan and a support card." },
    description: "Your plan and support card in one place, ready to copy or print for your visit.",
    primary: { empty: "Go to Get ready", ready: "Copy kit" },
  },
  "/say-it": {
    title: "Say it",
    h1: "Say it.",
    lead: "Pick what you need to say. Rumi writes a short script.",
    description:
      "Short scripts for things like booking an appointment or asking someone to repeat. Rumi does not call anyone.",
    primary: { script: "Copy" },
  },
  "/settings": {
    title: "Settings",
    h1: "Settings.",
    lead: "Change how Rumi looks, reads, and remembers.",
    description: "Change your name, reading style, theme, text size, motion, sound, and memory. Delete everything.",
    primary: null,
  },
} as const satisfies Record<string, PageMeta>;

export const NOT_FOUND = {
  title: "Page not found",
  h1: "We could not find that page.",
  lead: "The link may be old. Go back, or open the home page.",
  description: "This page does not exist. Go back or open the Rumi home page.",
  primary: "Go to the home page",
} as const;

export const ERROR_PAGE = {
  title: "Something went wrong",
  h1: "Something went wrong.",
  lead: "Try again. If it keeps happening, go to the home page.",
  description: "Something went wrong on this page. Try again or go to the home page.",
  primary: "Try again",
} as const;
