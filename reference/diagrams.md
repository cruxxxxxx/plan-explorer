# High-level sequence diagrams

The flows are what the user explores most, so make each one easy to take in at a glance and easy to point at.

## Shape

- **One scenario per flow.** For example "Reconnect", "Conflict surfaced to user" or "Cold start", not "Sync".
- **3–6 participants**, 8 at most. If you need more, split the flow.
- **4–10 messages.** Beyond about 12, split into "happy path" and "failure path" flows.
- **Participants are systems, modules, services, stores or people**, such as `Editor UI`, `Op log`, `Sync API` or `User`. They're never classes or methods unless the user is drilling into code.
- **Messages are intents in plain words**, such as `push ops since cursor`, not `PushAsync(ops, cursor)`. Keep each one under about 40 characters.
- Use one `Note over X: …` per flow at most, for the single thing to notice.
- Put the takeaway in `caption`, not in the diagram.

## Syntax that renders and maps reliably

```
sequenceDiagram
  %% people use actor; systems use participant with a short id and a readable label
  actor U as User
  participant UI as Editor UI
  participant Log as Op log
  %% ->> is a request, -->> is a reply
  U->>UI: types a sentence
  UI->>Log: append op
  Log-->>UI: ok
  Note over Log: ops queue until online
  alt conflict
    UI->>UI: three-way merge
  else clean
    UI->>Log: apply
  end
  loop each op
    Log->>UI: apply op
  end
```

- Declare every participant up front with `participant <id> as <Label>`. Ids are short, with no spaces and no hyphens. The id is what notes attach to (`…/actor/<id>`), so keep it stable.
- Use `->>` for a call, `-->>` for a return, and `-x` for a failure.
- Use `alt/else/end`, `opt/end`, `loop/end` and `par/and/end` for branching. Don't nest more than one level deep.
- Avoid `;`, `#`, `{}` and raw `<`/`>` in message text (the lint flags them). Write "and" or "then" instead of `;`. `<br>` is fine.
- Don't use `autonumber`. It adds noise, and notes already identify messages.
- Only `sequenceDiagram` gets per-message note targets. Other Mermaid types render, but notes attach to the whole flow.

## Checking: which tool when

| tool | cost | catches | run it |
|---|---|---|---|
| `scripts/check.mjs <dir>/plan.js` | instant, no browser | plan structure, ids, links, and a static Mermaid lint of every `sequenceDiagram` | after every edit. While live, the listener runs it for you and prints a `check` line only on failure. |
| `scripts/verify.sh <dir>` | headless Chrome, needs network | everything Mermaid itself rejects, in every diagram type | once after seeding, after structural diagram changes (new flows, participants or blocks), for flowcharts, and whenever the page shows "Diagram error". |

The static lint was calibrated against the engine's pinned Mermaid. Errors (each with its line number):
- `;` anywhere in message, note or label text (Mermaid ends the statement there);
- a message without `: text`, and bad arrows (`->>>`, `=>>`, `--` without a head);
- `alt`/`opt`/`loop`/`par`/`critical`/`break`/`rect`/`box` never closed, a stray `end`, `else` outside `alt`, `and` outside `par`;
- once any participant is declared: an undeclared participant in a message, `Note` or `activate` (Mermaid would silently draw a ghost participant for a typo);
- `end` as a participant id; a `Note` without `left of`/`right of`/`over`; any line Mermaid can't parse.

Warnings: `#` (`#name;` is read as an entity code), braces, raw `<`/`>`, hyphens in participant ids, nesting deeper than one level, `autonumber`, no participant declarations, and more than 8 participants.

## Flowcharts

When a flow is a structure or decision tree rather than a sequence, use `flowchart TB` (top-down), never `LR`. The engine's API dependency graph is also top-down.

## Coverage

For each area, consider:
1. the main happy path;
2. the most likely failure or edge case;
3. how the area hands off to a neighboring area.

Explore shows every flow on one page, and participants link to API types, so consistent participant names across flows (`Sync API` everywhere, never sometimes `Server`) make the whole plan read as one system.
