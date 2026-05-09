## Problem

Every MBB firm has its own AI assistant: Lilli at McKinsey, GENE at BCG, Sage at
Bain. Employee adoption sits between 75% and 90%. The dashboards say success.
The partners know that's a vanity metric. We turn the session logs they already
keep into the three answers no one else has: who to back, where to cut, and what
the firm is collectively failing to learn. Adoption was the easy part.

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

### Dashboard (demo surface)

One view for partners and L&D. Shows the three answers at team and firm level.
Individual-level access gated.

### Proxy + queue (in development)

A proxy sits in front of the firm's AI traffic, captures requests and responses,
queues them for analysis. The ingestion and centralization layer.

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

## Competition

- Bifrost: https://github.com/maximhq/bifrost (LLM gateway / proxy reference).

## References

- [Rewiring the way McKinsey works with Lilli](https://www.mckinsey.com/capabilities/tech-and-ai/how-we-help-clients/rewiring-the-way-mckinsey-works-with-lilli)
- [McKinsey rolls out Lilli to 7K employees (CIO Dive)](https://www.ciodive.com/news/McKinsey-generative-AI-Lilli-platform-internal-employees/691231/)
- [Inside BCG's AI product assembly line](https://www.hackdiversity.com/inside-bcgs-ai-product-assembly-line/)
- [Nearly 90% of BCG employees are using AI (illuminem)](https://illuminem.com/illuminemvoices/nearly-90-of-bcg-employees-are-using-ai-and-its-reshaping-how-theyre-evaluated)
- [Five ways Bain is leading with AI](https://www.bain.com/careers/life-at-bain/careers-blog/five-ways-bain-is-leading-with-ai/)
- [Bain & Company AI deployments press release](https://www.bain.com/about/media-center/press-releases/2023/bain--company-makes-pioneering-deployments-of-state-of-the-art-ai-tools-worldwide/)
