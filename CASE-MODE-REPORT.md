# Capital One TIP Case mode

Added **Case** beside Normal and STAR on the phone and in the desktop mode selector.
Its internal mode ID is `case_interview`; it uses **`gpt-6.1-sol` with `medium`
reasoning**. Existing STAR and Normal settings remain intact.

## Research and scope

Capital One describes cases as hypothetical, role-related scenarios and lists
Technology Development/Internship among programs with case and technical interviews.
See its [student and graduate application guide](https://www.capitalonecareers.com/student-and-grad-application-questions-answered-students-cdev).

Its [written case preparation guide](https://www.capitalonecareers.com/4-tips-to-ace-your-capital-one-case-interview-101-students)
emphasizes explaining reasoning, using evidence, making a recommendation, communicating
technical ideas clearly, and focusing on the presented problem rather than the resume.

The employer's [tech case workshop replay listing](https://app.eightfold.ai/events/candidate?plannedEventId=Mz8MwaeP)
specifically identifies a technical case interview for TIP/TDP, separate from the
technical interview. The written listing was read; the workshop itself was not
watched or registered for. The embedded general-preparation YouTube video could
not be fetched. No claim is made to reproduce actual questions or guarantee a
specific current round format.

These sources informed the response style. The technical, quantitative, code, and
banking-product cases used for validation were original synthetic exercises, not
verified interview questions or confidential interview material. The prompt tells
the model to follow the supplied case/recruiter instructions and adapt to the task.

## Response behavior

- Identify the objective and relevant supplied constraints.
- Give an answer immediately. The user's existing no-clarification-question
  preference is retained: missing details lead to explicit assumptions, formulas,
  or conditional recommendations. This adapts the public guide's conversational
  advice to the user's chosen practice flow.
- Connect customer/business impact to technical feasibility and the strongest
  practical alternative, without adding unnecessary architecture.
- For quantitative work, show readable arithmetic, units, rounding, and an
  interpretation. Monthly versus annual figures and changing inputs stay distinct.
- For code cases, give outputs, a concise trace, the bug/minimal correction, and
  useful validation. Respect supplied templates and the selected coding language.
- For a full case, conclude with a recommendation, key risk, and validation or
  success metrics. Follow-ups answer only the new point and retain earlier facts.
- Keep simple calculations or traces around 80–180 words and full recommendations
  around 250–450 when appropriate. Explicit length requests take priority.
- Use natural spoken explanations. No STAR labels, MuMix preference, personal
  stories, automatic resume discussion, or practice disclaimers for ordinary
  hypothetical case analysis.

The existing persistent context builder and streaming pipeline are reused for
typed, voice/green Send, screenshots, images, and resubmissions. Case excludes the
separate resume block and legacy DSA domain prompt; the shared conversation history
still supplies relevant prior case facts. It does not erase or create a conversation
when selected. Normal and STAR retain their prior behavior.

The selected mode persists through SQLite metadata, synchronizes using the existing
status event, and is snapshotted with model/reasoning/instructions for each active
request. No schema migration or new endpoint was needed. Mode changes do not start,
stop, or restart listening. The manual Start Listening / green Send flow is preserved.

## Validation

- **51 automated Node test cases passed**, plus the existing resume/listening
  assertion suites. New Case tests cover configuration, prompt separation, restart
  persistence, New Chat behavior, retained case context, exclusion of personal
  resume data, all shared request sources, images, and in-flight mode changes.
- Real Electron integration passed: HTTP selection of Case updated the desktop
  selector; selecting STAR through the native desktop control updated authoritative
  state; Case selection left listening running; toolbar controls remained visible.
  Existing manual Send and screenshot/conversation tests also passed. The providers
  are mocked in this integration test, while renderer microphone capture is real.
- Mobile TypeScript checking and Expo Android production JS/Hermes export passed.
  No physical phone installation/session or iOS build was performed.
- **Eight live Sol Medium requests** through the actual shared pipeline passed:
  break-even at 2,000 users; a cost-change follow-up at 3,000 users; annual-versus-
  monthly break-even rounding to 3,334 customers; a Java off-by-one trace (6 before
  correction, 12 afterward); concurrent transfer retry handling with idempotency;
  a notification-channel recommendation with missing numbers; reading an image
  table to choose Option B; and recalling that table when a tighter budget meant
  neither option qualified.
- Initial math responses contained LaTeX that the phone does not render. The prompt
  was corrected to require ordinary arithmetic. **Two further live math checks**
  returned the correct 2,000/3,334 results in plain text. The reusable live test also
  checks for raw LaTeX commands now.

The first eight requests averaged **5.6 seconds** to completion (2.3–12.9 seconds),
with first tokens in approximately **1.3–2.2 seconds**. These are observed timings,
not guarantees. The existing code-purpose annotation helper ran for the code
correction, as it does for other coding answers; no second case-analysis call was added.

Complete synthetic outputs are stored locally in
[the live-check artifact](artifacts/case-mode-live-checks.json) and
[the plain-math checks](artifacts/case-plain-math-checks.json).

## Use and checks

Restart Electron and reload Expo, then select **Case** on either device. Use the
same typed composer, attachments, screenshot workflow, or manual recording controls.
No extra credentials or setup are required on this checkout.

```sh
npm test
npm run test:case
npm --prefix mobile run typecheck
npm run test-mobile-main
npm run test:live-case
```

`test:live-case` is an optional paid API check using synthetic data and temporary
conversation storage. It does not alter the user's saved conversations or mode.

## Files changed for Case mode

- `src/services/assistant-mode.service.js`
- `src/services/conversation-context.service.js`
- `prompts/capital-one-tech-case.md` (new)
- `src/ui/assistant-controls.js`
- `index.html`
- `mobile/src/constants/assistantModes.ts` (new)
- `mobile/src/types/protocol.ts`
- `mobile/src/components/ChatMessage.tsx`
- `mobile/app/index.tsx`
- `scripts/test-case-mode.cjs` (new)
- `scripts/check-live-case-mode.cjs` (new)
- `scripts/test-mobile-main.cjs`
- `package.json`
- `env.example`
- `README.md`
- `CASE-MODE-REPORT.md` (new)
