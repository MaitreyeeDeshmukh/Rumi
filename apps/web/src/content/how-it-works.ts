// /how-it-works copy (spec section 6.2) and the made-up example cards for the three steps.
export const HOW = {
  stepperLabel: "The three steps",
  controlLabel: "What you control",
  sampleNote: "Right now Remember uses a sample visit made by our team.",
  safety: "Read about safety",
  steps: [
    {
      title: "Get ready",
      text: 'You write or speak what is going on. Rumi makes a plan of short sentences. Each line says "You said this" or "Suggested". Suggested lines start switched off. You can edit, remove, or add lines. Then you pick how you like to be supported. You can also pick up to two questions to bring.',
      controls: ["Edit or remove any line", "Turn suggested lines on or off", "Print or copy your support card"],
      example: {
        title: "Your plan",
        rows: [
          { label: "You said this", text: "I have had headaches for two weeks." },
          { label: "Suggested", text: "I want to ask about my sleep." },
        ],
      },
    },
    {
      title: "Practice",
      text: 'A pretend clinician asks one question at a time. You answer by typing or speaking. If you are stuck, press "Help me say it". It gives a hint, then a sentence with blanks, then a full sentence. Over time you need less help.',
      controls: ["Pause, repeat, or slow down", "Show your plan during practice", "End any time"],
      example: {
        title: "Practice call",
        rows: [
          { label: "Clinician", text: "How long have you had the headaches?" },
          { label: "You", text: "About two weeks." },
        ],
      },
    },
    {
      title: "Remember",
      text: 'Rumi reads a visit and writes a summary. Each point shows the lines it came from. If Rumi cannot find proof, it puts the point under "I could not confirm this". You also see which of your questions you asked yourself.',
      controls: ["Choose which voice is yours", "See exactly what is shared", "Copy or share it yourself"],
      example: {
        title: "Visit summary",
        rows: [
          { label: "Point", text: "Keep a sleep diary for two weeks." },
          { label: "Came from", text: "The doctor said: Please write down when you sleep." },
        ],
      },
    },
  ],
} as const;
