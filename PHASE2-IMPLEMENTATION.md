# Persistent conversations and manual recording

Implemented against the latest `origin/main` checkout. No user history was deleted
and no API keys were changed. This remains the existing Electron/Expo application.

## Recording behavior (updated user instruction)

1. Press **Start Listening** on the phone (or use the existing desktop/backtick control).
2. Capture continues through pauses. No silence timer submits an assistant question.
3. Press the green **Send** button on phone or desktop.
4. The controller immediately blocks further PCM and stops renderer/native capture.
5. It finalizes the pending provider transcript, assembles and deduplicates the
   recording's fragments, stops the provider, and submits one persistent conversation turn.
6. Listening stays off. Press Start Listening for the next recording.

This supersedes the original automatic VAD / Force Send specification. Internal
15-second transcription chunks bound Whisper/live provider buffers; they do not
stop listening or create assistant requests. Legacy VAD presets remain available
in the service for compatibility but are not exposed in the manual recording UI.
Microphone echo cancellation, gain control, noise suppression, and an 80 Hz high-pass
filter remain enabled. Playback avoids those microphone filters.

## Conversation and model pipeline

`ConversationContext` reads SQLite, never global session memory, for every user
request. It supplies system instructions, domain guidance when appropriate, the
mode snapshot, existing resume context, extractive older-history notes, pinned
facts, relevant older turns, recent complete turns, relevant original images,
and the current message exactly once. Failed, interrupted, pending, and synthetic
fallback assistant answers do not become completed context.

Recent complete turns have a 40,000-character allowance. Older exact-turn retrieval
has 16,000 characters; extractive rolling notes have 14,000; pinned facts have
8,000. Current text is limited to 32,000 characters. Original messages are never
replaced by summaries. Older retrieval uses lexical overlap; ambiguous references
may still need clarification. Image follow-ups select up to four current/relevant
historical originals, including ordinal references such as “first image.”

Requests serialize per conversation. Mode snapshots are immutable for the request:

| Mode | Model | Reasoning |
| --- | --- | --- |
| Normal (default) | `gpt-6-luna` | `low` |
| STAR Behavioral | `gpt-6.1-sol` | `medium` |

The STAR prompt requests four developed, story-driven sections for behavioral questions (typically 450–700 words, with the greatest depth in Action), direct
technical answers, and no invented experience or achievements. Resume context is
reused. There is no story bank or behavioral profile editor. Mode selection is
stored in SQLite metadata and broadcast to phone/desktop. Legacy environment model
overrides apply to legacy/diagnostic helpers, not the canonical Q&A pipeline.
Existing code-purpose annotations are retained when generated code needs them.

Response metadata records mode, model, reasoning, start/completion times, first-token
latency, elapsed processing time, conversation ID, and provider errors. Responses
continue to stream while SQLite persistence batches deltas. New Chat preserves
history/settings/mode. Old in-flight responses remain associated with their original
conversation and do not populate the new mobile timeline.

## Authenticated API additions

All endpoints below require the existing paired-device Bearer credential.

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/attachments` | Multipart fields `conversationId`, `requestId`, and one binary `image` |
| `GET /api/v1/attachments/:id/thumbnail` | Authenticated JPEG thumbnail |
| `GET /api/v1/attachments/:id/original` | Authenticated original image |
| `POST /api/v1/conversations/:id/context` | Replace pinned facts with `{ "facts": ["exact fact"] }` |
| `POST /api/v1/actions/send-speech` | Stop capture, finalize transcription, and submit one question |
| `POST /api/v1/actions/force-send` | Compatibility alias for the same stop-and-send behavior |
| `POST /api/v1/actions/assistant-mode` | Set `mode` to `normal` or `behavioral_star` |
| `POST /api/v1/actions/audio-preset` | Legacy service preset setting; manual UI has no VAD controls |
| `POST /api/v1/actions/delete-conversation` | Delete `conversationId`; requires `confirm: true` |
| `POST /api/v1/actions/clear-history` | Delete all conversations/images; requires `confirm: true` |

`POST /api/v1/messages` additionally accepts `conversationId` and `attachmentIds`.
Mutation request IDs and upload keys support retries. Concurrent Send requests
share a finalization promise. New/selected conversations use existing routes and
the desktop remains authoritative. Destructive history actions wait for active
requests to finish.

Images are decoded with Sharp; filenames and client MIME declarations are ignored.
Allowed formats are still PNG/JPEG/WebP, up to 10 MB, 24 megapixels, and 10,000 pixels
per side. Four images may be bound to one message. Staged uploads are scoped to
their paired device and conversation, and ownership is checked atomically when
binding. Paired devices share saved chat attachments. Public message events contain
metadata and attachment IDs, never image bytes or desktop file paths. Interrupted
uploads write no permanent file; staged uploads older than 24 hours and untracked
capture files are reclaimed at application startup. Original images are retained
until conversation/history deletion.

## Database migration

Schema version **2** migrates the existing attachment table inside a transaction:
adds explicit conversation ownership, nullable message binding for staged uploads,
device ownership, and a unique device/upload key. Existing IDs, hashes, paths, and
message associations are copied intact. Dimensions are stored in attachment
metadata and exposed on the API. A `conversation_context` table stores extractive
notes, a summary frontier, and pinned facts. Foreign-key cascades remain enabled.
Global mode and audio preferences use existing metadata storage.

## Validation performed

- Full `npm test`: 43 Node test cases, plus the existing resume and listening lifecycle assertion suites, passed. Coverage includes existing screenshot, resume, audio routing, web primitive,
  persistence/authentication, and listening shortcut tests, plus OpenAI transport,
  context/migration, image validation/upload, and manual transcription tests.
- `npm --prefix mobile run typecheck` passed.
- Expo Android production JavaScript/Hermes export passed; this is not a native
  device installation or an app-store build.
- Real Electron main-process integration passed over this machine's private LAN
  interface. Verified phone HTTP authentication, actual renderer microphone
  startup, desktop mode indicator synchronization, no submission after provider
  finalization/silence, one submission for concurrent Send requests, stopped
  renderer capture after Send, screenshot serialization, and New Chat isolation.
  Its capture/model/transcription provider results are mocked, except renderer
  microphone capture itself. Applied microphone settings reported noise suppression,
  echo cancellation, and automatic gain control as enabled at 48 kHz mono.
- Actual OpenAI Responses API: six synthetic-data requests passed. Earlier project
  facts and the exact timeout `1777` survived follow-up; behavioral answers used
  Situation/Task/Action/Result; a technical question in STAR stayed direct; an image
  containing `CACHE 42` was read and its number recalled in a later visual question.
- After the requested STAR depth update, a separate live behavioral-answer check
  returned 479 words: Situation 94, Task 65, Action 212, and Result 111. It used
  Luna with medium reasoning, retained the hypothetical framing, and gave each
  section a developed narrative. The eight conversation pipeline tests also passed.
- STAR was subsequently switched to `gpt-6.1-sol` with medium reasoning. A live
  request through the shared speech conversation pathway returned a 599-word STAR
  answer, with the requested model and reasoning recorded in response metadata.
  Normal remains on GPT-6 Luna with low reasoning. The eight pipeline tests passed
  with model-specific assertions for all input sources and in-flight mode changes.
- Actual OpenAI live transcription: generated synthetic Windows speech was streamed
  with manual mode enabled. A pause did not commit; explicit finalization committed
  exactly once and returned “How does binary search work and what is its time complexity?”

Not performed: a physical Expo phone session, phone photo-library taps/permissions,
an iOS device build, a controlled noisy-room recognition comparison, or real Azure
and local Whisper provider runs. Their finalization paths have automated tests.
No claim of perfect noise removal or verified noisy-room recognition improvement
is made. The LAN bridge retains the project's existing authenticated HTTP design.

## Setup and reproducible checks

Dependencies (`sharp`, `busboy`, Expo-compatible `expo-image-picker`) and lockfiles
are updated. Run `npm install` and `npm --prefix mobile install` on another checkout,
restart Electron and Expo, and allow photo access on the phone. Custom native Expo
builds need rebuilding for image-picker; Expo Go includes the module. No additional
API credentials or manual database migration are needed.

```sh
npm test
npm --prefix mobile run typecheck
npm run test-mobile-main
cd mobile && npx expo export --platform android --output-dir ../artifacts/phase2-mobile-export
```

Optional paid synthetic API checks: `npm run test:live-conversation`; for
`node scripts/check-live-transcription.cjs`, supply a 16 kHz mono PCM16 WAV through
`LIVE_TRANSCRIPTION_FIXTURE`. Never use a private recording for these fixtures.

Official API compatibility references consulted:
[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) and
[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), plus
[Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).
Installed OpenAI SDK 7.39 supports Responses image inputs and reasoning effort.

## Modified and added files

- `PHASE2-IMPLEMENTATION.md`
- `README.md`
- `env.example`
- `index.html`
- `main.js`
- `mobile/app.json`
- `mobile/app/conversation.tsx`
- `mobile/app/history.tsx`
- `mobile/app/index.tsx`
- `mobile/app/settings.tsx`
- `mobile/package-lock.json`
- `mobile/package.json`
- `mobile/src/components/ChatMessage.tsx`
- `mobile/src/hooks/useDesktopConnection.ts`
- `mobile/src/services/api.ts`
- `mobile/src/types/protocol.ts`
- `package-lock.json`
- `package.json`
- `preload.js`
- `prompts/behavioral-star.md`
- `scripts/check-live-conversation.cjs`
- `scripts/check-live-transcription.cjs`
- `scripts/test-conversation-pipeline.cjs`
- `scripts/test-force-send.cjs`
- `scripts/test-live-transcription.cjs`
- `scripts/test-mobile-main.cjs`
- `scripts/test-openai.cjs`
- `src/core/config.js`
- `src/core/code-presentation.js`
- `src/services/action-controller.service.js`
- `src/services/assistant-mode.service.js`
- `src/services/conversation-context.service.js`
- `src/services/conversation-store.service.js`
- `src/services/image-validation.service.js`
- `src/services/listening-controller.service.js`
- `src/services/live-transcription.service.js`
- `src/services/llm.service.js`
- `src/services/mobile-bridge.service.js`
- `src/services/pending-utterance.service.js`
- `src/services/speech.service.js`
- `src/ui/assistant-controls.js`
- `src/ui/main-window.js`

The later SWE-specific refinement, resume grounding fix, and live evaluations are documented in [STAR-SWE-REPORT.md](STAR-SWE-REPORT.md).
