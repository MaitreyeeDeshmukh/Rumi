// Contact page copy (spec section 6.4). src/lib/contact.ts imports the messages and labels it needs.
export const CONTACT = {
  emergencyLine: "In an emergency, call or text 988 (US) or call 911.",
  form: {
    heading: "Write to us",
    name: "Your name (optional)",
    topic: "What is this about?",
    message: "Your message",
    messageHint: "Please do not write health details here.",
    copyMessage: "Copy my message",
    noScript: "Your email app opens when you press the button. Write your message there.",
  },
  topics: {
    question: "A question",
    feedback: "Feedback",
    "working-together": "Working together",
    problem: "A problem with Rumi",
  },
  errors: {
    short: "Write a message first. Use at least 10 characters.",
    long: "Your message is too long. Use 1000 characters or fewer.",
  },
  mail: {
    subjectPrefix: "Rumi: ",
    nameLabel: "Name: ",
    sentFrom: "Sent from the Rumi contact page.",
  },
  notices: {
    sent: 'Your email app should open. You press send. If nothing opened, use "Copy my message" or "Copy email".',
    long: 'Your message is long. If your email app cuts it off, use "Copy my message".',
    missingEmail: "The contact email is not set. Set NEXT_PUBLIC_CONTACT_EMAIL in .env.local. The form shows after that.",
  },
  copied: "Copied.",
  copyFailed: "Could not copy. The text is selected. Copy it yourself.",
  emailCard: {
    heading: "Email us",
    copy: "Copy email",
    open: "Open email app",
  },
  emergencyCard: {
    heading: "In an emergency",
  },
  helpCard: {
    heading: "Need help using Rumi?",
    link: "Go to Help",
  },
  fine: "This is a student project. We reply when we can.",
} as const;
