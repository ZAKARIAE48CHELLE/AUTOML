# Auto: the visible body of the AI Studio agent

Auto is a tiny stickman hero (white head, thin black body, a cape with "AutoML" on the back).
He is **not a chatbot and not the agent itself**. He is the body that hosts the background agent: the agent decides, Auto shows it (walks, points, flies, opens a portal, lights a bulb).

Today this is frontend only, driven by fake events. The real agent (E3 with an LLM) comes in a later version; E3 is not stable yet.

## Files in this folder

- `auto-demo.html`: standalone working prototype. Open it in a browser. It is the source of truth for the look and the animations (rig, cape physics, faces, particles).
- `README.md`: this brief.

## Vision (target; most of it is NOT built yet)

- Summoned with a keyboard shortcut. Left click on Auto opens the chat input (reuse the existing `ChatPanel`).
- If ignored for a while he falls asleep and disappears. Any warning or recommendation makes him reappear automatically.
- The agent runs in the background. On an error, Auto shows it. On an optimization idea, a light bulb appears above his head; clicking it shows the suggestion for the pipeline or system.
- Later: he points at or flies to where the user should look, or opens a portal to it.
- Errors interrupt immediately. Tips and recommendations wait until the user is idle (not mid-drag, not typing). Only one bulb at a time.
- Academic project: playful, never too serious.
- **Hidden easter egg:** poking him repeatedly makes him get angry, fire a warning shot with an AK into the sky, then empty the magazine if poked again. Nobody is told about it. Do not mention it in any UI text, help panel or user-facing doc. Remove the "Keep poking and he gets angry" hint from the demo's help text when porting.

Built in the demo already: walking, running, jumping, flip, sleeping, dancing, dizzy, drag and throw, petting, cape physics, eyes following the cursor, speech bubbles, and the easter egg.
Not built yet: summon shortcut, auto-disappear and reappear, light bulb, event-driven behaviour, pointing and portals.

## Repo facts (checked)

- `apps/web`: React 18, Vite, TypeScript, Tailwind 3, framer-motion, react-query, react-router. UI text is in French.
- Theme: the `dark` class on `<html>` (`apps/web/src/lib/theme.tsx`, `useTheme`).
- Mount point: `apps/web/src/shell/Layout.tsx`. The existing chat is `apps/web/src/modules/assistant/ChatPanel.tsx`, toggled by the "Assistant" button in `Layout.tsx`.
- Execution events already exist: `apps/web/src/api/events.ts` (SSE, or the mock bus in `apps/web/src/mock/bus.ts`), type `ExecutionEvent` from `@contracts/src`.
- Scope: frontend only, branch `courtish`. Do not modify the services (E1 to E3).

## Port notes (demo to app)

1. The demo is one vanilla JS canvas file with no dependencies. Port it to `apps/web/src/modules/auto/` as a React component (for example `AutoMascot.tsx`) mounted once in `Layout.tsx`, plus a small `autoBus.ts` fake event emitter. Keep the draw and rig code as plain TypeScript running in `requestAnimationFrame`; do not put per-frame values in React state.
2. Drop the demo scaffolding: sky, hills, floor, stats panel, help panel, button bar, cookie, ball, cursor glow. Keep the stickman rig, cape, face, speech bubble, the particles you need, and the sleep, wave, jump and dizzy behaviours.
3. **Critical:** the demo canvas covers the whole viewport and captures pointer events. In the app the overlay must be `pointer-events: none` except on Auto's own hit area (or use a small canvas that follows him). Otherwise it blocks the whole UI.
4. Theme: the demo reads `prefers-color-scheme` / `data-theme`. Map that to the app's `dark` class on `<html>`.
5. Respect `prefers-reduced-motion`. Sound off by default in the app. The shortcut and the chat trigger must be keyboard accessible.
6. In-app speech is in French.
7. Name clash: the app already has a "Mode Auto" badge (assistant mode, in `Layout.tsx`). Not renaming yet. Keep the mascot name in one constant so it is easy to change later.

## Suggested first milestone

Auto appears in the real app, idles, falls asleep after about 20 seconds without interaction and disappears, then reappears on a fake `warning` event with a bulb above his head. Left click opens the existing `ChatPanel`. No backend changes.
