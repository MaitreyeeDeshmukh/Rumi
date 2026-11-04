# Rumi
North American AI Challenge

Your world. Your pace. Your way. An interactive prototype of an independence and community companion for neurodivergent young adults.

Open `dist/index.html` in a browser to try it.


React 18 + TypeScript (TSX), bundled with esbuild into one HTML file. React loads from cdnjs as a UMD global.

    npm i esbuild@0.21.5
    node build.mjs        # writes dist/index.html

## Files
- src/core.tsx      state model, localStorage, icons, mascot, shared UI
- src/data.tsx      sample data and simulated logic (practice scenarios, organizer, summary, rescue flows, circles)
- src/app.tsx       shell, navigation, onboarding, Home
- src/health.tsx    appointments, prep, practice call, recording, summaries, sharing
- src/rescue.tsx    Rescue Mode flows
- src/circles.tsx   discovery, group chat, meetups, safety
- src/day.tsx       My Day, Start With Me, Money Mirror
- src/you.tsx       profile, accessibility, themes, contacts, privacy, data, My Growth
- src/template.html CSS design tokens (three themes) and page shell

Types are light (many `any`), so a strict tsc pass is a good first cleanup task.
