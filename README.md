# Fast static site builder (makefun-site drop-in)

[![bounty](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Nadanese93/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Nadanese93/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for makefun-site 1.0.0: `solve.js` answers exactly as the
reference does on every case — same front matter, template dialect, Markdown
subset, slug rule and build report, byte for byte — while running
significantly faster on CPU time. `main.ts` is the harness driver: it reads
every case from `/input/cases.json`, answers each one alone with `run()`, and
writes `/output/answers.json`.

How it is faster: hand-scanned single-pass Markdown inline rendering with
bulk HTML escaping, ASCII fast paths for slugs, a manual word counter, and
templates compiled once per case into plain JavaScript render functions.
Zero dependencies, only Node built-ins, no I/O, no caching between cases.
