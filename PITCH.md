## Problem

Every MBB firm has its own AI assistant: Lilli at McKinsey, Deckster at BCG,
Sage at Bain. BCG just crossed 90% employee adoption; McKinsey is past 75%. The
dashboards say success. The partners know that's a vanity metric. We turn the
session logs they already keep into the three answers no one else has: who to
back, where to cut, and what the firm is collectively failing to learn. Adoption
was the easy part.

## Target

Management consulting firms (MBB and tier-2). Buyer: partner, engagement
manager, or Director of L&D.

## The three answers

1. **Who to back.** Which consultants actually leverage AI vs. seat-fill.
   Surface wizards, flag the stuck.
2. **Where to cut.** Wrong-model use, abandoned sessions, redundant prompts,
   context bloat.
3. **What the firm is collectively failing to learn.** Cluster retry-loops and
   unresolved questions into a real-time capability-gap map.

## Solution

### Dashboard (what we ship in 1 day)

A local dashboard for a partner or engagement manager to actually understand how
their team uses AI. One screen, the three answers, no login.

### Proxy + queue (the pipe behind it)

An LLM proxy in front of the firm's AI traffic captures requests and responses
and feeds the dashboard. We run it locally against a seeded session log for the
demo.

## Demo

Format: 90 seconds, live and interactive (no screen recording). Shape: a
partner's morning. Three questions, three reveals from the dashboard, one kicker
(firm-wide blindspot map).

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

- [Rewiring the way McKinsey works with Lilli](https://www.mckinsey.com/capabilities/tech-and-ai/how-we-help-clients/rewiring-the-way-mckinsey-works-with-lilli)
  — current >75% monthly active stat.
- [McKinsey rolls out Lilli to 7K employees (CIO Dive)](https://www.ciodive.com/news/McKinsey-generative-AI-Lilli-platform-internal-employees/691231/)
  — initial rollout context.
- [BCG execs: AI across the company increased productivity (Computerworld)](https://www.computerworld.com/article/3491334/bcg-execs-ai-across-the-company-increased-productivity-employee-joy.html)
- [Nearly 90% of BCG employees are using AI (illuminem)](https://illuminem.com/illuminemvoices/nearly-90-of-bcg-employees-are-using-ai-and-its-reshaping-how-theyre-evaluated)
- [Five ways Bain is leading with AI](https://www.bain.com/careers/life-at-bain/careers-blog/five-ways-bain-is-leading-with-ai/)
- [Bain & Company AI deployments press release](https://www.bain.com/about/media-center/press-releases/2023/bain--company-makes-pioneering-deployments-of-state-of-the-art-ai-tools-worldwide/)

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
- change target audience to code/tech companies
- include "productive" distribution in the spend flow
- unite the dashboard with the ui/ and backend
- ask

## Future

- Session satisfaction
