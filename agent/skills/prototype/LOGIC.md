# Logic Prototype

A tiny interactive terminal app that lets the user drive a state model by hand. Use when the question is about **business logic, state transitions, or data shape** — things that look reasonable on paper but only feel wrong once you push them through real cases.

## When this is the right shape

- "Does this state machine handle the edge case where X then Y?"
- "Does this data model actually let me represent..."
- "What should the API feel like before I write it?"
- Anything where the user wants to press buttons and watch state change.

## Process

### 1. State the question

Write down what state model and what question you're prototyping. One paragraph, top of file or README. A logic prototype that answers the wrong question is pure waste.

### 2. Pick the language

Use whatever the host project uses. Match existing conventions for tooling.

### 3. Isolate the logic in a portable module

Put the actual logic behind a small, pure interface that could be lifted into the real codebase. The TUI is throwaway; the logic module shouldn't be.

Shape depends on the question:

- **Pure reducer** — `(state, action) => state`. Good for discrete events.
- **State machine** — explicit states and transitions. Good when "which actions are legal right now" is part of the question.
- **Pure functions** over a plain data type. Good when there's no implicit current state.
- **Class/module with clear method surface** when logic owns ongoing internal state.

Keep it pure: no I/O, no terminal code. The TUI imports it; nothing flows back.

### 4. Build the smallest TUI

On every tick, clear the screen and re-render the whole frame. Two parts:

1. **Current state** — pretty-printed, one field per line. Bold field names, dim context.
2. **Keyboard shortcuts** — listed at the bottom: `[a] add user  [d] delete  [q] quit`

Behaviour: initialise → read one keystroke → dispatch → re-render → loop until quit. Full frame fits one screen.

### 5. Make it runnable in one command

Add to the project's task runner. Never require remembering a path.

### 6. Hand it over

Give the user the run command. Interesting moments: "that shouldn't be possible" or "I assumed X would be different" — those are bugs in the idea.

## Anti-patterns

- Don't add tests.
- Don't wire to the real database.
- Don't generalise ("what if we wanted X later").
- Don't blur logic and TUI together — keep the TUI as a thin shell over a pure module.
- Don't ship the TUI shell into production. The logic module behind it is worth keeping; the shell is not.
