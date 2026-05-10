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

what about if user prompt injects?  
- Prompt injects will become less and less effective.  
- Measures can be taken against that with a detection system  

why would the company not built this themselves?  
- It is constant evolution, so they would have to spend way more to have a single solution than if they used our solution, for which we work full-time.  

what if the models are hosted locally?  
- It still works because we use a proxy, so we only have to run the monitoring app on the server hosting the model.  

what about the privacy of the company data?  
- It is all hosted on-premises with a simple docker image. No data goes out.  

how do you measure hard vs simple tasks and how does this correlate to costs  
- Right now for the demo, it is a mix of large language and embedding models treating the conversations and attributing them scores, but the idea is to have our own models to treat it.  

does it work with codex?  
- It is against their regulations, but all big providers will switch soon, or else people will adapt and change their ai provider.  

what about employees that will refuse monitoring?  
- Currently, most of the entreprise solutions already have monitoring implemented by default, and they have to accept it, so we believe that it won't be too much of a problem.  

why you and not the competition?  
- Most competitors analyze AI systems. We analyze human systems using AI systems. Their product is destined for security or technical officers and engineers. Ours is destined for managers.  
- Our real competitor is Oximy, which does the same thing as we do, but they detect failures, wastes and dangerous conversations while we use this information to help managers decide who needs more training and how to optimize costs.  

### TODO

- what is our competition?
- change target audience to code/tech companies
- include "productive" distribution in the spend flow
- unite the dashboard with the ui/ and backend
- ask

## Future

- Session satisfaction  
- Track recursive loops  
- Use a lot of metrics collected automatically on ai conversations and create models with it in order to better predict failures and problems with ai usage  
