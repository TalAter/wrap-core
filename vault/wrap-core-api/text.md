---
name: text
description: Pure string helpers. `truncateMiddle` — keep head + tail of an oversized string with a middle indicator, for LLM context budgets.
package: wrap-core/text
---

# text

Stateless string utilities. No app identity, no config — plain functions. Home for small text helpers that both consumers need; today just middle-truncation for fitting large outputs into an LLM context budget.

## Public symbols

| Symbol | Shape | Note |
| --- | --- | --- |
| `truncateMiddle` | `(text: string, maxChars: number) => string` | Returns `text` unchanged when `length <= maxChars`. Otherwise keeps a head and tail, splicing in `\n[…truncated, showing first X and last Y of Z chars]\n`. Snaps the cut to newline boundaries when possible. `maxChars` is approximate — output may exceed it by up to ~80 chars (the indicator line); negligible against a 200K budget. Degrades gracefully at `maxChars` 0 (emits head + indicator, empty tail). |

## Usage

```ts
import { truncateMiddle } from "wrap-core/text";
const forPrompt = truncateMiddle(commandOutput, 8000);
```
