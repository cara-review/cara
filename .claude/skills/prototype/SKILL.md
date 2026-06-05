---
name: prototype
description: Build a throwaway prototype to answer a design question before committing. Routes between two branches — a runnable terminal app for logic/state questions, or radically different UI variations toggleable from one route. Use when user says "prototype this", "try a few designs", "sanity-check this model", or wants to explore before building.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md)
- **"What should this look like?"** → [UI.md](UI.md)

If ambiguous and user is unavailable, default to whichever matches the surrounding code (backend → logic; page/component → UI) and state the assumption.

## Rules (both branches)

1. **Throwaway and clearly marked.** Locate near where it'll actually live so context is obvious. Name it so readers know it's a prototype, not production.
2. **One command to run.** Whatever the project's existing task runner supports.
3. **No persistence by default.** State lives in memory unless the question is specifically about persistence.
4. **Skip the polish.** No tests, no error handling beyond what makes it runnable, no abstractions.
5. **Surface the state.** After every action (logic) or on every variant (UI), show the full relevant state.
6. **Delete or absorb when done.** Capture the answer somewhere durable (commit message, issue, NOTES.md), then remove the prototype.

## When done

The answer is the only thing worth keeping. Capture it before deleting. If the user is around, ask what it taught them. If not, leave a NOTES.md placeholder.
