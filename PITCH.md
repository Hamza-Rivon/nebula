## Problem

Tech companies are the largest buyers of AI today. Every engineer runs Claude
Code, Cursor, Copilot, Devin, or an in-house agent — and many run several at
once. AI spend has crossed "noticeable" and is heading for "biggest line item
after payroll." The vendor dashboards say success: tokens up, sessions up,
adoption up. The CTO knows that's a vanity metric. We turn the session logs
the company already keeps into the three answers no one else has: who to back,
where to cut, and what the engineering org is collectively failing to learn.
Adoption was the easy part.

## Target

Tech companies whose engineers run AI agents at scale — Series-B and up, plus
AI-native shops. Buyer: CTO, VP Engineering, or Head of Platform / AI
Productivity. Strongest fit where Claude Code, Cursor, Copilot, Devin, or
in-house coding agents are a meaningful per-engineer monthly spend.

## The three answers

1. **Who to back.** Which engineers actually leverage AI vs. seat-fill.
   Surface wizards (people whose AI use compounds into shipped work), flag the
   stuck.
2. **Where to cut.** Wrong-model use, abandoned sessions, redundant prompts,
   context bloat, retry loops — the spend that produces nothing.
3. **What the org is collectively failing to learn.** Cluster retry-loops and
   unresolved questions into a real-time capability-gap map: which subsystems,
   libraries, and patterns the team can't get the AI to nail.

## Solution

### Manager view (the showcase)

A single dashboard for a CTO or eng manager to actually understand how their
team uses AI. One screen, the three answers, no login. Default landing: the
non-tactical, leadership-grade view.

### Tech drilldown (one click deeper)

From any insight you can dig down into the underlying sessions, requests, and
audit trail — full traceability and observability of every prompt, tool call,
and token. Same product, audience-aware depth.

### Proxy + analysis pipeline (the pipe behind it)

An OpenAI-compatible LLM proxy sits in front of the company's AI traffic and
captures every request/response. On session boundary it kicks an analysis job
that scores the session, extracts asks/unresolved questions, flags waste, and
updates the manager-facing intel. Single Docker container, one port.

## Demo

Format: 90 seconds, live and interactive (no screen recording). Shape: a CTO's
Monday morning. Three questions, three reveals from the dashboard, one kicker
(org-wide blindspot map). Optional cherry on top: drill from a wizard's profile
straight into the actual session transcript.

Open decisions:

- Wizard signature behavior (what visibly makes a top prompter top).
- Blindspot cluster used as the kicker.
- Single interactive control on screen.

## Hackathon criteria

Product, Uniqueness, AI use, Execution, Impact.

## Open questions

- Pitch language (EN/FR).

## Tools we build on

The proxy/ingestion layer is solved territory. We pick one and put insights on
top.

- **LiteLLM** — most-deployed OSS LLM proxy. OpenAI-compatible, drop-in in front
  of any provider, hooks for logging.
- **Helicone** — observability-first proxy. Logs every request/response,
  latency, cost. Closest in spirit to what we capture.
- **Bifrost** (https://github.com/maximhq/bifrost) — high-perf gateway (~11μs
  overhead at 5K RPS), semantic caching, failover, Prometheus metrics.

## References

TODO: swap in tech-company AI-spend references (e.g. Claude Code / Cursor /
Copilot adoption stats, dev productivity studies). The MBB references that
seeded the original framing have been removed — they no longer match the ICP.

## Feedback

- out of 3 options, option 2 is best

## Questions

- what about if user prompt injects?
- why would the company not built this themselves?
- what about if the models are hosted locally?
- what about the privacy of the company data?
- how do you measure hard vs simple tasks and how does this correlate to costs

### TODO

- what is our competition?
- include "productive" distribution in the spend flow
- unite the dashboard with the ui/ and backend
- ask

## Future

- Session satisfaction
- Pool agent sessions instead of a session per use
