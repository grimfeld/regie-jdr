# Recurring problem: usage limit stops every agent at once

- 2026-11-11 to 12: the 5-hour usage limit stopped all four running M2 agents (#36, #37, #39, #42) mid-slice. Each agent's work was saved; they were resumed with SendMessage after the user said "Try again". No work lost.
- Cost reference (subagent tokens, 2026-11-11): a typical M1 slice used 130k–310k tokens; four agents in parallel drain the limit fast.
- How to apply: after a limit stop, resume the same agents (SendMessage), never start new ones. When a lot of work remains, prefer 2–3 parallel agents over 4–5.
- 2026-11-12: second usage-limit stop (M3 closeout agent); resumed with SendMessage after reset.
