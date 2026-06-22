# Discovery ledger — cross-disciplinary literature review

> **Purpose.** Ground the design of a *discovery ledger* for `fr`: a first-class way to **notice, capture, and incentivise** an interesting/useful side result that is *off* the locked goal, without throwing hands up at "interestingness is subjective."
>
> **Provenance.** Synthesized 2026-06-22 by the `deep-research` workflow harness (run `wf_047ea024-8a9`): 5 search angles → 25 sources fetched → 116 falsifiable claims extracted → top 25 adversarially verified (3-vote, 2/3-refute kills) → **22 confirmed, 3 killed** → 10 synthesized findings. Confidence tags below are the harness's, after verification.
>
> **Status of sources.** All surviving findings rest on primary/canonical sources (Dunbar TICS 2001; Platt *Science* 1964; Lehman & Stanley EC 2011; Mouret & Clune; POET; Oudeyer & Kaplan; Pathak ICM 2017; the Funk "Serendipity in Science" preprint). See **Caveats** for what was *refuted* or *named-but-ungrounded* — read it before treating any recommendation as settled.

---

## TL;DR

You cannot plan or force serendipity, but you **can** reliably engineer three things:

1. a low-cost **capture ritual** — notice-and-park *before* judging;
2. a persistent **archive** — the substrate against which novelty/reuse is computed;
3. an **incentive channel decoupled from the single locked objective**.

The diagnosis the design started from is a *measured* result, not a hunch: a single fixed objective is **provably deceptive** — it can actively misdirect search and leave reachable results unreached. So an anti-stall breaker keyed only to reducing the one FRONTIER is, structurally, **also an anti-serendipity mechanism**. A second, objective-decoupled reward channel (the discovery ledger) is the documented cure.

The keystone for `fr`: **the append-only log makes both anti-progress-theatre *and* interestingness checkable without trusting the claim** — real movement is a measurable decrease/reuse against *recorded prior state*, and you cannot fabricate history you never logged.

---

## Verified findings

### F1 — You can't force serendipity; you can lower the cost of *noticing* and pair exposure with a recognition step. The trait that pays off is OPENNESS, not depth. — *high*

"Serendipitous discovery requires more than just exposure to the unexpected; it also requires the ability to apprehend its potential scientific value" (Pasteur's "chance favours only the prepared mind"). In the AACR2 library-reshelving natural experiment (2.4M papers, 523,511 scientists), the most-**open** scientists were **+8.01%** more likely to publish a destabilizing/disruptive paper after exposure (β=0.033, p=0.000); **deep-experience** scientists showed **no** boost (β=−0.006, p=0.352) and leaned on familiar/older references.

**Design implication.** A capture channel cannot rely on parking/exposure alone — it needs a cheap *recognition/triage* step. And the actor that pays off is the open explorer, which argues the discovery channel should **not** be gated by the goal-locked expertise of the current FRONTIER line.
Sources: arXiv 2308.07519; Dunbar & Blanchette TICS 2001.

### F2 — A proven CAPTURE ritual exists: record reasoning/results *live*, classify *afterward* (capture-before-judging). — *high*

Dunbar's in-vivo method videotaped/audiotaped leading molecular-biology and immunology labs at their meetings and analyzed them sentence-by-sentence; labs followed 3 months–1 year. This is the empirical backbone (study-grade, not folklore) and it *models the core ritual the ledger emulates*: record the reasoning/result as it happens, classify later.
Sources: Dunbar & Blanchette TICS 2001; ResearchGate 243774176.

### F3 — Anomaly-handling and direction-generation are different modes, and an append-only log is the substrate for the first. — *high*

Scientists explain a "strange"/unexpected result by a **near** analogy to a highly similar remembered experiment, isolating the **single differing feature** ("usually one key superficial feature, such as incubation time… changed the key feature"). **Distant** structural analogies are only ~25% of analogies but >80% of *those* form hypotheses (new directions).

**Design implication.** An append-only log of attempts *is* the substrate of near-analogy anomaly detection — a result is "surprising" precisely by comparison against the nearest prior logged attempt that differs in one feature. Argues the ledger should record enough per-pull structure (target, residual, evidence class) to support nearest-prior comparison.
Source: Dunbar & Blanchette TICS 2001.

### F4 — A single fixed objective is inherently, provably deceptive. — *high*

"Objective functions themselves may actively misdirect search towards dead ends… the objective does not necessarily reward the stepping stones." On the deceptive **hard maze**, objective-based NEAT solved **3/40** runs (random selection 4/40); **novelty search — ignoring the goal — solved 39/40**; on the medium maze it was ~3× faster (18,274 vs 56,334 evals). POET shows capabilities that "cannot be solved by direct optimization alone, or even through a direct-path curriculum-building control algorithm" (statistically significant, not a formal proof).

**Design implication.** The FRONTIER-stall breaker keyed *only* to reducing the one locked objective is structurally an anti-serendipity device; an objective-decoupled reward channel is the documented cure.
Sources: Lehman & Stanley EC 2011; POET (arXiv 1901.01753).

### F5 — The proven novelty mechanism is a PERMANENT ARCHIVE + k-NN distance. — *high*

Novelty = average distance (sparseness) to the *k* nearest behaviors in the current population **plus** an append-only **archive** of behaviors that were novel when they originated ("characterizes the distribution of prior solutions in behavior space"; "current generation plus archive give a comprehensive sample of where search has been"). MAP-Elites returns a *map* of high-performing-yet-diverse solutions rather than a single optimum.

**Design implication.** The discovery ledger *is* this archive; "novelty vs the archive" = nearest-prior distance. Store enough per-discovery feature description (target/cluster/technique tags) to make k-NN meaningful. **Failure mode:** pure novelty drifts into useless diversity, and grids scale poorly with feature dimensionality — pair with a quality/relevance filter (serendipity = unexpected **AND** relevant).
Sources: Lehman & Stanley EC 2011; Mouret & Clune (arXiv 1504.04909).

### F6 — "Surprise" is formalizable as a cheap, log-derivable signal — but it measures ERROR, not payoff. — *high*

(a) Oudeyer-Kaplan: surprise = actual prediction error ÷ **expected** (meta-predicted) error — high when error is high but a *low* error was anticipated ("low-prior-but-occurred"). (b) ICM (Pathak et al.): curiosity = error predicting the consequence of one's own actions in a *learned feature space* (ignores what the agent can't affect).

**Design implication.** A logbook can derive a per-pull surprise score = *(did it land a result?)* against *(the prior expectation — e.g. a low pre-registered `p_true`, or an arm marked exploratory/background)*. **Critical caveat:** these formulas measure *epistemic error* (an unexpected *failure*), so "high-payoff" is a design overlay — the ledger must explicitly combine **unexpected WITH relevant/useful** (recommender definition of serendipity).
Sources: Oudeyer & Kaplan; Pathak et al. ICM 2017.

### F7 — The fix for noisy-TV / progress-theatre is to reward LEARNING PROGRESS (decrease of error over time), not raw novelty/error. — *high*

Learning Progress Motivation `r = Er(t−θ) − Er(t)` rewards the *decrease* of prediction error, explicitly to avoid the trap where naive novelty over-rewards the inherently unpredictable (a leaf blowing in the wind). Progress-maximizing motivations "combine both high exploration and organization potentials… avoiding situations or goals too easy or too difficult."

**Design implication — THE ANTI-PROGRESS-THEATRE PRINCIPLE.** Real movement is a measurable **decrease in a residual against a recorded prior state over time**, which an append-only log can derive and a self-asserted thin claim cannot fabricate (you cannot reduce a residual you never logged). This *re-justifies* fr's existing "breaker resets only on a FRONTIER reduction, not a residual-rename" rule, and tells you the discovery channel's interestingness should reward **progress/competence-gain** (a discovery that unstuck a thread), not raw surprise.
Source: Oudeyer & Kaplan.

### F8 — A named, lightweight capture-and-triage ritual that distinguishes a real testable step from busywork: Platt's "strong inference" + "The Question." — *high*

Platt 1964: four explicit steps applied "formally and explicitly and regularly," written "in a permanent notebook" (Fermi's method). **The Question** — on any explanation ask *"what experiment could disprove your hypothesis?"*; on any experiment ask *"what hypothesis does your experiment disprove?"* — "forces everyone to refocus on… whether there is or is not a testable scientific step forward" and counters becoming "method-oriented rather than problem-oriented." The literature's sharpest **named anti-progress-theatre device**.

**Design implication.** The discovery-capture ritual should be a single cheap structured line (mirroring fr's one required `fr log`) recording the observation **plus a disprovability/testability field**. A discovery with no answer to The Question is parked `class=stated` (notice-and-park); one with a resolvable test is promotable.
Source: Platt 1964, *Science*.

### F9 — Carry MULTIPLE working hypotheses; make discoveries PROMOTABLE; treat CROSS-THREAD REUSE as load-bearing. — *high*

Chamberlin's "method of multiple working hypotheses" (via Platt): committing to one hypothesis breeds attachment ("affection for his intellectual child") that bends facts to theory; multiple hypotheses "distribute the effort and divide the affections… purely a conflict between ideas." POET *promotes* generated challenges into first-class arms and — crucially — its ablation makes **transfer load-bearing**: "the ability to transfer solutions from one environment to another proves essential… without [it], no extremely challenging environments are solved at all."

**Design implication.** (1) A discovery should be **promotable into a new arm/target** (a new working hypothesis funded in parallel) via fr's existing EXPLORE/PIVOT + arm registry. (2) The cheapest robust interestingness signal is **cross-thread reuse** — an artifact/lemma reused by a pull on a *different* arm. fr's log already tags each pull with arm + target, so "this artifact was reused by a different arm" is directly derivable.
Sources: Platt 1964; POET (arXiv 1901.01753).

### F10 — Integrative recommendation for the ledger. — *medium (design-fit synthesis, not a single source)*

Drawing the findings onto fr's contract (`src/types.ts`) and PRD §4.5:
- **Separate, append-only ledger, weaker trust** — a raw discovery is `class=stated`/`claimed`, **not** `banked`/`tested`, until externally checked (F1's recognition step; fr's anti-laundering invariant).
- **Exempt from the breaker** — a discovery record is **neutral to the `stale` derivation** (neither resets nor increments it), since it's off-arm. The breaker interrupts *over-concentration* on the locked goal; an off-goal capture is the opposite.
- **Promotable** into a new ArmConfig/target (F9) and, at a higher bar, into a new goal.
- **Capture ritual** — Platt's one-line notice-and-park + The Question (F8).
- **Anti-theatre** — reward learning-progress/reuse (F7, F9) over raw self-asserted surprise; an un-reused/un-tested discovery **decays** (cf. fr's rigour-weighted decay, PRD §4.6).

---

## Computable interestingness signals — menu (ranked by translatability to fr)

| Signal | Source lit | How fr derives it cheaply | Known failure mode |
|---|---|---|---|
| **Cross-thread reuse** *(lead)* | POET transfer ablation (F9) | artifact cited/reused by a pull on a *different* arm; log already tags arm+target | minimal — robust |
| **Learning progress** | Oudeyer-Kaplan (F7) | measurable decrease of a residual vs a *recorded prior* log state over time | none material (by construction) |
| **Low-prior-but-occurred surprise** | Oudeyer-Kaplan; ICM (F6) | result lands on arm marked exploratory/background, or low pre-registered `p_true` | measures *error not payoff* → must combine with relevance, else noisy-TV |
| **Novelty vs. archive (k-NN)** | novelty search; MAP-Elites (F5) | nearest-prior distance over technique/cluster tags | needs a feature representation; drifts into useless diversity |

**Unifying property:** every usable signal is a comparison against *recorded prior state*. That is exactly what makes it (a) cheap for a pure core to compute from the log and (b) immune to progress-theatre — you can't fake history you never logged.

---

## Refuted claims (do NOT use)

- **CD / disruption index** (Funk & Owen-Smith; Wu-Wang-Evans) as a directly-computable novelty signal — **refuted (1-2)**. Real, but needs a citation network; not cleanly translatable to a small campaign log. Use cross-thread reuse instead.
- **"Diversity (MAP-Elites) finds a better single optimum than objective search"** — **refuted (0-3)**. Do *not* claim diversity beats direct optimization *on the objective*. The discovery channel buys **reachability**, not a better assault on the locked goal.
- **"Oudeyer-Kaplan give a clean two-family, formulae-backed portable menu"** — **refuted (0-3)**. The intrinsic-motivation typology is *not* a turnkey formula menu; treat learning-progress as a principle, not a drop-in equation.

---

## Caveats — what is weaker / ungrounded (read before relying)

- **The progress-theatre canon named in the brief produced NO confirmed claim in this batch** — Goodhart's law, Campbell's law, surrogation, the McNamara fallacy. The anti-theatre recommendation rests instead on Platt's "The Question" (F8) + Oudeyer-Kaplan learning-progress (F7), both verified. **A follow-up pass should target Goodhart/surrogation directly.**
- **Also named-but-ungrounded** (not refuted, just no verified claim here): Merton & Barber *The Travels and Adventures of Serendipity*; Kuhn on anomalies; Klein's data/frame sensemaking & *Seeing What Others Don't*; Pirolli & Card information foraging; DeMarco's *Slack* and the serendipity-permitting-vs-forcing distinction.
- **The openness-beats-depth result (F1)** comes from a **preprint** (arXiv 2308.07519) of uncertain peer-review status — strong, not settled.

## Open questions carried forward

1. What do Goodhart/Campbell/surrogation/McNamara *specifically* prescribe for distinguishing real movement from thin progress — and does learning-progress fully substitute? (needs a second research pass)
2. Cheapest concrete **feature representation** for k-NN "novelty vs archive" over a math-physics log (behaviors are residuals/lemmas/techniques, not robot trajectories) — what must `fr log` capture?
3. **Decay/eviction policy** for a parked discovery never tested or reused — reuse fr's rigour-weighted decay (PRD §4.6)? When does an un-promoted discovery archive to `background` vs surface for promotion?
4. Is a lightweight **"atypical combination"** proxy (two arms/clusters that never co-occurred now jointly producing a result) worth the complexity over plain cross-thread reuse?

## Sources (primary unless noted)

- Dunbar & Blanchette, "How scientists really reason" / TICS 2001 — `pages.ucsd.edu/~scoulson/203/dunbarTICS.pdf`
- Platt, "Strong Inference", *Science* 1964 — `science.org/doi/10.1126/science.146.3642.347`
- Lehman & Stanley, "Abandoning Objectives: Novelty Search…", EC 2011 — `cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf`
- Mouret & Clune, "Illuminating search spaces…" (MAP-Elites), arXiv 1504.04909
- Wang/Lehman/Clune/Stanley, "POET", arXiv 1901.01753
- Oudeyer & Kaplan, intrinsic-motivation typology / learning progress — `pyoudeyer.com/oudeyer-kaplan-neurorobotics.pdf`
- Pathak et al., "Curiosity-driven Exploration" (ICM), ICML 2017
- Itti & Baldi, "Bayesian surprise", `ilab.usc.edu/publications/doc/Baldi_Itti10nn.pdf`
- Schmidhuber, "Formal Theory of Creativity, Fun, and Intrinsic Motivation"
- "Serendipity in Science" (Nahm/Murciano-Goroff/Park/Funk), arXiv 2308.07519 *(preprint)*
- Funk & Owen-Smith / Wu-Wang-Evans disruption index, *Science* 1240474 *(refuted as directly computable here)*
- Recommender-systems serendipity metrics — arXiv 2211.10346; eugeneyan.com *(blog)*
- Campbell's law; McNamara fallacy — Wikipedia *(secondary; canon not yet primary-sourced)*
