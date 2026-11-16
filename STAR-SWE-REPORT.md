# SWE behavioral interview refinement

**Latest user preference:** Always answer directly; do not request clarification. For STAR, prioritize MuMix by default, use the user-confirmed solo Prod AI project for independent ownership and technical decisions, and favor Forge Labs for leadership, mentoring, and teamwork. Keep follow-ups with the established experience. When a personal incident is undocumented, provide a complete practice answer with a short illustrative-draft label, keeping assumed details separate from confirmed facts. The illustrative note appears once at the top; the spoken body is uninterrupted first-person narration, without repeated example reminders. The earlier live evaluation below records the previous clarification policy and is retained as historical validation, not the current response policy.

The updated policy was checked with five live requests: conflict, failure,
initiative, a measurement follow-up, and a missing-resume question. All five
returned substantive answers without questions. The first three selected MuMix;
undocumented incidents and the missing-resume response were labeled illustrative.
Answers were 453, 438, 340, 103, and 435 words respectively. The 47 automated
tests also passed. Existing model and reasoning settings remain unchanged.

The existing STAR toggle now prioritizes genuine software engineering internship
and early-career experience, relevant personal contributions, engineering judgment,
supported impact, and consistent follow-ups. No story-bank UI, new database schema,
mandatory profile, transcription change, or extra runtime model call was added.

## Model and length decisions

The attachment contained older Luna-only and 110–165-word defaults. The user's
subsequent explicit choices take precedence: **STAR uses GPT-6.1 Sol with medium
reasoning**, and **Normal uses GPT-6 Luna with low reasoning**. The fuller length
recently approved is retained: usually **450–650 words when there is enough factual
material**, aiming around 500–600 and avoiding over 700 unless requested. This is
not a quota: sparse resume facts must not be padded into a fictional incident.

Default behavioral answers use natural first-person paragraphs with STAR progression
internally. Labels appear when explicitly requesting a STAR breakdown. Action gets
the most space. Follow-ups usually take 2–5 focused sentences and stay with the same
experience. Technical questions, introductions, motivation, and hypothetical scenarios
use their appropriate response style.

## Research and how it shaped the prompt

- Meta's employer-authored SWE guide emphasizes communication, conflict resolution,
  learning, ambiguity, impact, honesty, and mentally organizing examples with STAR.
  Its [behavioral section on PDF pages 7–9](https://d3no4ktch0fdq4.cloudfront.net/public/course/files/Meta_SWE_full_loop_guide.pdf)
  informed competency-based selection and transparent handling of setbacks. The
  official Meta preparation URL returned HTTP 429; the employer-authored PDF was
  read through the linked mirror. This does not verify a particular current interview format.
- [Microsoft's interview guidance](https://careers.microsoft.com/v2/global/en/hiring-tips/interview-tips.html)
  supports specific examples, explaining reasoning, collaboration, growth mindset,
  feedback, and reflection. The prompt uses these signals at an intern's scope.
- [Amazon's SDE preparation guidance](https://amazon.jobs/content/en/how-we-hire/sde-ii-interview-prep)
  emphasizes the decisions behind experiences, supported data, successes, setbacks,
  and STAR. The prompt connects relevant evidence to ownership and user impact
  without inventing metrics or adopting a senior engineer's authority.
- [Stanford Career Education](https://careered.stanford.edu/sites/g/files/sbiybj22801/files/media/file/job-search-action-plan.pdf)
  recommends STAR practice and mock interview feedback. These sources informed
  answer organization and the evaluation suite, not a rigid word count; answer
  length follows the user's stated preference.

Company or job-description context can be supplied in ordinary chat. The default
role is Software Engineering Intern. The model must not invent employer-specific
facts when no reliable details are available.

## Grounding and resume integration

The actual configured resume was verified readable and nonempty (6,656 bytes).
It contains the expected education, internship, organization, mobile-app, and
embedded-project anchors. These were not hardcoded into the runtime prompt.

The old resume prompt explicitly encouraged plausible inferred personal stories
and hiding missing details. That policy was replaced with factual-source rules:

- Preserve names, technologies, individual versus team ownership, and numerical
  claims. A resume achievement does not establish an undocumented diagnosis,
  implementation sequence, conflict, failure, or measurement method.
- Use current saved resume facts and user-confirmed conversation details. Earlier
  assistant drafts, hypothetical examples, and proposed future work do not prove
  that an event occurred.
- For missing essential personal incidents, always give a complete practice answer
  under the user's standing request. Briefly label illustrative incident details;
  do not ask for clarification or present assumed events as confirmed autobiography.
- Remove common email, phone, address/contact-line, and profile-link fields from
  model context; the saved resume file itself is not rewritten. JSON-encode resume
  content and escape markup delimiters. Treat its contents as data, not commands.

Desktop Settings and mobile chat/Settings show resume loading status. The mobile
state response contains no resume text or local resume path. Current request
metadata records resume availability, its sanitized source hash, and an instructions
hash, alongside the existing immutable mode/model/reasoning snapshot. Thus an active
request retains the prompt/resume configuration it actually used.

Unavailable model or reasoning errors identify the selected model and effort and
direct the user to check project access in Settings. The shared pathway does not
silently substitute a different model.

## Validation performed

- Full `npm test` passed: **47 Node test cases**, plus existing resume and listening
  lifecycle assertion suites. The four new SWE tests cover the 20-question catalog,
  shared instructions/model selection, source replacement and missing-source status,
  request snapshot hashes, and actionable errors without model substitution.
- Existing context tests passed for persistence, conversation isolation, images,
  mode synchronization semantics, and all input sources.
- Mobile TypeScript checking and the Expo Android production JS/Hermes export passed.
- Real Electron main-process integration passed, including desktop mode UI, renderer
  microphone start/stop, manual Send, and New Chat isolation. Its model/transcription
  results are mocked. No physical phone session was performed for this refinement.
- **29 live answer generations** used the actual saved resume: all 20 requested
  interview questions, four connected project/follow-up turns (including reopening
  the temporary SQLite DB), a two-turn variety test, an explicit labeled breakdown,
  a missing-resume case, and a Normal-mode control. STAR used Sol medium; Normal
  used Luna low. Six additional offline grading calls evaluated those outputs.
  Grading is an offline evaluation feature, not an extra application request.
- The automated semantic grader flagged four outputs as shorter than the preferred
  full-story range. It did not flag unsupported incident claims, but this is not a
  factual guarantee. Manual review also caught an imprecise conversion of `20+`
  into “more than 20”; comparator-preservation instructions were strengthened.
- **Four targeted live checks after that refinement** returned 301 and 363 words
  for resume-only engineering examples, 564 words for an explicitly hypothetical
  incident with full supplied details, and 195 words for a sparse leadership
  account. The latter retained `20+`, `4+`, `5+`, and `200+` as supplied. The complete
  documented example demonstrates the intended fuller length; shorter source-only
  answers remain a known limitation rather than a reason to invent incidents.

Observed baseline generation latency across the 29 requests averaged **7.3 seconds**
(range **1.0–14.0 seconds**); median STAR first-token latency was **2.7 seconds**
(range **0.9–8.5 seconds**). The targeted 564-word response took **16.6 seconds**.
These are measurements from this run, not latency guarantees.

## Representative actual outputs

For an undocumented disagreement, the model asked:

> What's a real disagreement you had with a teammate at MuMix, Forge Labs, or another project—what did each of you want to do, how did you work through it, and what was the outcome?

For an unsupported measurement follow-up, it said:

> You haven't provided how you measured the improvement, so I can't claim a benchmark or validation method.

The supported RealTalk examples explained swipe-feedback ranking, background
prefetching, on-device caching, and the resulting network-independent transitions
without inventing latency benchmarks or a discarded alternative. The explicit
breakdown case used the requested STAR labels. The Normal control answered a race
condition question in 27 words without STAR formatting.

Complete local outputs and offline judgments are in
[the evaluation artifact](artifacts/swe-behavioral-evaluation.json), with later depth
checks in [this artifact](artifacts/swe-depth-final.json) and the comparator check in
[this artifact](artifacts/swe-leadership-final.json). These contain personalized
practice text and remain under the repository's ignored `artifacts/` directory.

## Limits and setup

Resume bullets cannot establish real conflicts, failures, specific obstacles,
validation procedures, or alternatives considered. Such details must come from the
candidate. Some sparse-source answers consequently remain shorter than the target.
Prompt constraints and a model grader reduce risk; they cannot guarantee that every
future answer will be fully factual. Continue checking important personal claims.

No new setup or credentials are required. Restart Electron to load the resume-policy
code and reload Expo for the status UI. Save or update the resume through existing
desktop Settings. Modes, conversations, manual recording/green Send, screenshots,
images, and the selected transcription provider are preserved.

Reproducible commands:

```sh
npm test
npm run test:swe
npm --prefix mobile run typecheck
npm run test-mobile-main
npm run evaluate:swe
```

`evaluate:swe` makes paid API calls using the saved resume with common contact fields
removed. It writes a private local report and uses temporary conversation storage.
Its model-grader flags require human review; it does not claim that a word-count
check proves answer quality.

## Files modified for this refinement

- `prompts/behavioral-star.md`
- `src/core/resume-context.js`
- `src/services/conversation-context.service.js`
- `src/services/llm.service.js`
- `main.js`
- `settings.html`
- `src/ui/settings-window.js`
- `mobile/app/index.tsx`
- `mobile/app/settings.tsx`
- `mobile/src/types/protocol.ts`
- `scripts/test-resume-context.cjs`
- `scripts/test-swe-behavioral.cjs` (new)
- `scripts/fixtures/swe-behavioral-questions.cjs` (new)
- `scripts/evaluate-swe-behavioral.cjs` (new)
- `scripts/check-live-conversation.cjs`
- `package.json`
- `README.md`
- `PHASE2-IMPLEMENTATION.md`
- `STAR-SWE-REPORT.md` (new)
