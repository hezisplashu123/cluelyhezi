<div align="center">

# OpenCluely

**The invisible AI interview copilot.**

Real-time AI help on a stealth overlay that screen sharing cannot see. Ask by voice or screenshot, and get clear answers that stream in as you need them.

<p>
  <a href="https://github.com/TechyCSR/OpenCluely/releases/latest"><img src="https://img.shields.io/github/v/release/TechyCSR/OpenCluely?style=for-the-badge&label=Latest&color=111111&labelColor=000000" alt="Latest release" /></a>
  <a href="https://github.com/TechyCSR/OpenCluely/releases"><img src="https://img.shields.io/github/downloads/TechyCSR/OpenCluely/total?style=for-the-badge&color=111111&labelColor=000000" alt="Downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-111111?style=for-the-badge&labelColor=000000" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-111111?style=for-the-badge&labelColor=000000" alt="Platforms" />
</p>

<a href="https://opencluely.techycsr.dev"><b>Website</b></a> &nbsp;|&nbsp;
<a href="#download">Download</a> &nbsp;|&nbsp;
<a href="#quick-start">Quick start</a> &nbsp;|&nbsp;
<a href="#how-it-works">How it works</a>

</div>

## Demo

https://github.com/user-attachments/assets/896a7140-1e85-405d-bfbe-e05c9f3a816b

## What it is

OpenCluely is a desktop app for technical interviews and practice. It places a small overlay on your screen that recording and conferencing tools do not capture. You can speak a question or take a screenshot, and the AI answers in real time. The answer streams into a floating window and an optional chat panel, with clean code blocks and syntax highlighting.

It is free and open source. Processing stays on your machine, and the only thing that leaves your device is the request you send to the AI provider.

## Highlights

- **Invisible overlay.** Windows stay out of Zoom, Google Meet, Microsoft Teams, Discord, and OBS captures. You see the answer, the call does not.
- **Hidden during screen share.** When a share starts, the app can hide every window on its own.
- **Real-time voice.** Speech is split on natural pauses instead of a fixed timer, so one spoken question stays one question. Filler phrases that Whisper invents on silence are dropped before they reach the model.
- **Configurable streamed answers.** Route voice replies to chat, the floating overlay, or both.
- **Direct image analysis.** Screenshots go straight to OpenAI for visual reasoning, with no slow OCR step in between.
- **Flexible local voice.** Choose manual start/stop capture or automatic voice-activity detection without fixed-timer sentence cuts.
- **Session memory.** The whole conversation is remembered, so follow-ups, edge cases, and optimizations keep their context.
- **Resume-aware answers.** Paste your resume experience into Settings to ground typed, spoken, and screenshot answers in your actual background.
- **Language aware.** Tailored answers for C++, C, Python, Java, and JavaScript.
- **Stealthy by design.** Runs under ordinary system names, ships with no telemetry, and keeps your session local.
- **Cross platform.** Pre-built installers for Windows and Linux (.deb and AppImage). macOS runs from source in one command.

## Download

Pre-built installers are published with every release. These links always point at the newest version.

| Platform | File | Notes |
|---|---|---|
| Windows | [Setup .exe](https://github.com/TechyCSR/OpenCluely/releases/latest) | NSIS installer. Adds a Start Menu shortcut. |
| Linux (Debian or Ubuntu) | [.deb](https://github.com/TechyCSR/OpenCluely/releases/latest) | Pulls system deps automatically (Python, ffmpeg, GTK). |
| Linux (universal) | [.AppImage](https://github.com/TechyCSR/OpenCluely/releases/latest) | No install. Run `chmod +x` then launch. |

> **macOS:** there is no pre-built download. The app is unsigned and un-notarized, so macOS Gatekeeper blocks it as "damaged and can't be opened." Run OpenCluely from source instead — see [Quick start](#quick-start). It is a one-line `./setup.sh` once Node.js is installed.

Every build is produced automatically on GitHub Actions and ships with SHA-256 checksums. Each release also lists the full set of commits it includes.

The website at [opencluely.techycsr.dev](https://opencluely.techycsr.dev) detects your operating system and offers the right installer directly.

## Quick start

On Windows, the app starts in **Not Listening**. Press the unmodified backtick
key (the key above Tab) to start listening; press it again to stop. The key
works globally while OpenCluely is running, including when another application
has focus. The small click-through indicator in the top-left reflects the real
provider and PCM capture state. The speaker button uses the same controller.

By default it captures your physical microphone so spoken input appears in the
toolbar. Settings → Speech Recognition → Listening Source can switch to system
playback, including the other person's call audio, across audio outputs. That
mode does not open your microphone and needs no virtual audio cable. Other playback
(videos, music, and notifications) can also be transcribed. Local Whisper waits
for about 700 ms of silence, then transcribes; the app combines transcript
fragments for another 800 ms before requesting an answer. Transcription and AI
processing add to that delay. System playback capture requires the Electron
version in this project's dependencies (44 or newer).
Captured PCM is explicitly resampled to 16 kHz mono before it reaches the
selected transcription provider. Speaker enrollment and speaker identification
are not part of the listening path.

To verify routing, run `node scripts/test-audio-routing.cjs`. On Windows,
`electron scripts/test-system-audio.cjs` also checks actual playback capture
with a brief quiet tone, confirms no microphone requests, and checks cleanup.
Run `npm run test-listening` for serialized start/stop, held-key, stale-session,
OFF-state PCM rejection, error-state, and hook-release coverage.

If you would rather build from source, three steps are all it takes.

1. Clone the repository.

   ```bash
   git clone https://github.com/TechyCSR/OpenCluely.git
   cd OpenCluely
   ```

2. Run the setup script.

   ```bash
   ./setup.sh
   ```

   The script installs Node dependencies, creates your `.env` from the example, sets up a local Whisper virtual environment, points the config at it, and launches the app.

3. Add your OpenAI key.

   On first launch the Settings window opens automatically. Create an API key at [OpenAI Platform](https://platform.openai.com/api-keys) and paste it in, or edit `.env` directly. Both work, and changes are picked up without a restart.

4. Optional: open Settings → Interview Background, paste your resume information as text, and click **Save background**. The settings screen shows the estimated number of input tokens added to each answer. Clear it there at any time to stop sending resume context.

### Platform notes

- On Windows, use Git Bash (included with Git for Windows) or WSL to run `setup.sh`.
- On macOS and Linux, your normal terminal works.
- **macOS users must build from source** (steps above) — there is no pre-built `.dmg`. Because the app is unsigned, a downloaded build would be blocked by Gatekeeper as "damaged"; running from source avoids that entirely.
- No manual `npm` commands are needed. The script handles everything.

### Setup script options

```bash
./setup.sh --build                # Build a distributable for your OS
./setup.sh --ci                   # Use npm ci instead of npm install
./setup.sh --no-run               # Set up only, do not launch
./setup.sh --install-system-deps  # Install sox for the microphone (optional)
./setup.sh --skip-whisper         # Skip the local Whisper bootstrap
```

## Configuration

The setup script writes sensible defaults. The only required value is a OpenAI API key.

```bash
# Required
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-6-luna

# Optional speech provider. Pick one.
SPEECH_PROVIDER=whisper

# Azure option
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=your_region

# Local Whisper option
WHISPER_COMMAND=whisper
WHISPER_MODEL_DIR=.whisper-models
WHISPER_MODEL=small
WHISPER_LANGUAGE=auto
WHISPER_DEVICE=auto
WHISPER_PYTHON=
WHISPER_CAPTURE_MODE=vad
WHISPER_RESPONSE_TARGET=both
WHISPER_MANUAL_MAX_MS=90000
WHISPER_GPU_IDLE_MS=60000
```

Speech is optional. If no provider is configured, the microphone button hides itself across the app.

## Optional voice setup

You can use local Whisper for offline transcription or Azure Speech for a cloud option.

For local Whisper, `./setup.sh` handles the full setup. It creates `.venv-whisper`, installs `openai-whisper`, points `.env` at the virtual environment, creates `.whisper-models`, and runs a quick speech test. The app reads its own PCM WAV recordings directly; ffmpeg is only needed when transcribing other audio formats through the CLI fallback.

For Azure Speech, create a Speech resource in the [Azure Portal](https://portal.azure.com/), then add the key and region to `.env` with `SPEECH_PROVIDER=azure`.

## How it works

1. **Ask.** Speak a question using automatic pause detection or manual capture, or capture a screenshot from the desktop controls.
2. **Reason.** OpenAI reads the audio or image with full conversation context and works toward a precise answer.
3. **Answer.** Voice responses stream to chat, the overlay, or both, according to Settings.

## Desktop and phone controls

Use `npm.cmd run desktop` for the Windows desktop only, `npm.cmd run phone`
for the Expo development server only, or `npm.cmd run desktop:phone` to launch
both together. On first use, enter the desktop address and phone password
`9898`; the phone securely stores its device credential and reconnects afterward.

Application commands are buttons, not global keyboard hooks. The desktop toolbar
provides capture, send, speech, answer-panel, skill, language and settings controls.
The phone focuses on capture, submission, previews and conversation history. The
separate desktop transcription/chat panel is no longer created.

Queue each screenshot with **Capture Screenshot**, then press **Send to AI** to
analyze the complete batch. Failed requests restore the batch for retry. The
in-memory queue is limited to 20 images or 150 MB. Desktop and phone use the same
persisted target. If exactly one VMware Workstation or Player window is found it
is selected automatically; use phone Settings to select among multiple windows,
or explicitly select a host monitor. The mouse position does not affect capture.

For a VM, restore the VMware application window before capture. Window capture may
include VMware menus and borders; minimized windows and some protected or black
frames are not reliably capturable. A failed window capture is reported instead of
silently switching monitors. In phone Settings, optional crop percentages can trim
the window; capture again to preview the result. When window capture fails, Windows
can retry from the containing monitor only if VMware is verified, foreground,
unobscured, entirely on one display, and a viewport crop has been configured.
Automatic viewport detection is not currently implemented. A guest-side agent would be a separate integration
and may be needed for reliable minimized-guest capture. VM audio must play through
the host playback device to reach computer-audio capture.

### Mobile bridge architecture

The Electron main process owns capture, speech, model requests, presentation, and
history. Its private-LAN bridge exposes a small authenticated `/api/v1` HTTP API
and an authenticated WebSocket at `/api/v1/events`. The phone sends commands and
renders canonical events; SQLite remains authoritative. Permanent device tokens
are never placed in URLs, and the OpenAI key is never returned by the bridge.

Enable phone control in desktop Settings, then enter the displayed private LAN
address and phone password `9898` in the Expo app. The password login issues a
random device credential that is stored in the phone's SecureStore and can be
revoked in desktop Settings. Passwords and bearer credentials travel over HTTP
and WebSocket on the LAN; use only a trusted private network. The bridge binds
to one private interface; do not configure router port forwarding.

The phone is an audio-free receiver. **Start Computer Microphone** remotely
starts the paired computer's physical input microphone; no phone microphone
permission is requested and no phone audio is sent over the network. Interim
transcripts, finalized questions, and streamed answers travel back over the
authenticated event socket and are persisted in desktop history. The desktop
speech provider permits only one capture source at a time, so starting the
computer microphone cleanly replaces any active desktop playback capture.

For a local diagnostic, `npm.cmd run capture-diagnostic` lists the available
VMware and monitor targets without sending images to a model. To save a diagnostic
frame, run `npm.cmd run capture-diagnostic -- --save <new-file.png>` with one
VMware window open; inspect and delete the file when finished. A specific source
can be selected with `--source <source-id>`.
For a diagnostic-only viewport crop in PowerShell, set
`$env:OPENCLUELY_DIAGNOSTIC_CROP = '0,0,1,1'` before running the command; values
are normalized x,y,width,height from 0 to 1. Remove the environment variable
afterward with `Remove-Item Env:OPENCLUELY_DIAGNOSTIC_CROP`. It does not change
the saved app target.

History is stored under Electron's OS-managed `userData` directory:

```text
<userData>/conversations/history.sqlite
<userData>/conversations/captures/<attachment-id>.png
```

SQLite uses foreign keys, WAL journaling, and schema migrations. `conversations`
stores durable threads; `messages` stores linked user/assistant turns, status,
source, skill, context mode, and errors; `attachments` stores private file paths,
sizes, and SHA-256 hashes; `idempotency` prevents retry duplicates. Short-term model
context remains bounded separately from permanent history.

### Run on Windows and Expo Go

```powershell
npm.cmd install
npm.cmd start

cd mobile
npm.cmd install
npx.cmd expo start --lan
```

Verification commands:

```powershell
npm.cmd test
npm.cmd run pack
npm.cmd run typecheck --prefix mobile
npx.cmd expo-doctor@latest mobile

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\node_modules\.bin\electron.cmd scripts/test-answer-panels.cjs
& .\node_modules\.bin\electron.cmd scripts/test-continuous-audio.cjs
& .\node_modules\.bin\electron.cmd scripts/test-manual-capture.cjs
& .\node_modules\.bin\electron.cmd scripts/test-mobile-main.cjs
```

1. Start OpenCluely from the repository with `npm.cmd start`.
2. Put the phone and computer on the same private network.
3. In `mobile/`, run `npx.cmd expo start --lan` and scan the QR code with Expo Go.
4. Enable phone connections in desktop Settings and log in with its displayed
   LAN address and password `9898`. Later launches reuse the saved credential.
5. Tap **Start Computer Microphone** and speak near the computer. The phone does
   not request microphone permission. Tap **Stop Computer Microphone** when done.
6. Confirm that the question and streamed answer appear, then send a typed
   follow-up. Screenshots are available as a secondary action.
7. Restart both applications and confirm that history remains available.

Expo's development-server tunnel does not tunnel this desktop API. Same-LAN access
is required. If Windows Firewall prompts, allow Node/Electron only on **Private
networks**. Otherwise add a private-network inbound TCP rule for port `32190`; do
not expose it on Public profiles or configure router port forwarding.

## Project status

OpenCluely is under active development. The core is stable and improvements ship regularly.

### Done

- Stealth overlay with a draggable command bar and a click through toggle
- Hidden during screen share, with automatic hiding when a share begins
- Screenshot capture with direct OpenAI analysis, no OCR step
- Real-time voice input that segments on natural pauses, not a blind timer
- Utterance coalescing so one spoken question becomes one answer
- Configurable manual or VAD-driven voice capture
- Persistent local Whisper worker with optional CUDA acceleration and idle GPU release
- Configurable chat/overlay routing for streamed voice answers
- Whisper hallucination filter that drops phantom phrases on silence
- AI response window with markdown and syntax highlighting
- Desktop and authenticated Expo Go controls for capture, visibility, interaction, chat, and settings
- Session memory and a full chat UI
- Language picker and a DSA skill prompt
- Optional Azure Speech and local Whisper, with an auto hiding mic button
- Multi-monitor and area capture support
- Window binding and positioning
- Settings management with disguise and stealth modes

### Planned

- Multiple model backends alongside OpenAI (OpenAI, Anthropic, local)
- Auto typing of code snippets into editors and IDEs
- Export of conversation history to markdown or PDF
- Deeper stealth, including process name randomization

## Troubleshooting

<details>
<summary>Setup issues</summary>

- **setup.sh will not run.** Make sure you are in the project folder (`cd OpenCluely`) and that the script is executable (`chmod +x setup.sh`). On Windows, use Git Bash.
- **Setup stops with exit code 130.** That means Ctrl+C was pressed. Run `./setup.sh` again.
- **Node or npm not found.** Install Node.js 18 or newer from [nodejs.org](https://nodejs.org/), restart the terminal, and retry.

</details>

<details>
<summary>App issues</summary>

- **Electron will not start or shows a blank window on Linux.** Try `npm run dev`, and make sure X11 or XWayland is available in headless setups.
- **macOS screen capture does not work.** Grant Screen Recording permission under System Settings, Privacy and Security, then relaunch the app.
- **Windows SmartScreen blocks the app.** Click More info, then Run anyway, or use `npm start` during development.
- **Microphone or voice not working.** Voice is optional. For Azure, add valid keys to `.env`. For Whisper, install `openai-whisper`, `ffmpeg`, and `sox`, then set `SPEECH_PROVIDER=whisper`.

</details>

<details>

<summary> Limitations </summary>

- **Screen-capture invisibility does not work on Linux.** The overlay stays hidden from screen shares and recordings only on **macOS** and **Windows**. This relies on Electron's `setContentProtection`, which maps to `NSWindowSharingNone` on macOS and `WDA_EXCLUDEFROMCAPTURE` on Windows. Electron provides **no equivalent on Linux** (neither X11 nor Wayland), so on Linux the call is a silent no-op and the overlay **will be visible** to anyone you screen-share with. This is a platform limitation, not a bug — there is no window flag on Linux that excludes a window from framebuffer capture. If you need capture-invisibility, run OpenCluely on macOS or Windows. As a partial workaround on Linux, share a single application window instead of your entire screen, or place the overlay on a monitor you are not sharing.

</details>



## Privacy and ethics

OpenCluely collects no data and sends no telemetry. Processing happens locally, and your session stays on your device. Requests to the AI provider are encrypted in transit.

The app is built for learning and practice. You are responsible for following the rules of any interview you take and the policies of the companies involved.

## License

Released under the MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- OpenAI for the AI reasoning
- Azure Speech and OpenAI Whisper for optional voice input
- Electron for the cross platform desktop runtime
- [Vysper by varun-singhh](https://github.com/varun-singhh/Vysper) for UI and structure inspiration

<div align="center">

Built by [TechyCSR](https://techycsr.dev). If OpenCluely helped you, consider giving it a star ⭐

</div>
<!-- Legacy speaker-recognition documentation removed from the active product.

Voice enrollment, recognition, and filtering run entirely on the desktop. The
phone remains a remote control for screenshots, messages, conversation history,
and starting the computer microphone; it does not record or transport voice.

## Install and enroll

Open desktop **Settings → Voice Recognition** and select **Install / Repair**.
Model downloads are opt-in. The installer creates `speaker-python` and
`speaker-models` inside Electron's actual user-data directory, pins
SpeechBrain's `spkrec-ecapa-voxceleb` revision, and completes a real offline
embedding before reporting the model ready. Normal use is offline afterward.
Advanced users may still override discovery with `SPEAKER_PYTHON` and
`SPEAKER_MODEL_DIR`.

Choose a physical computer microphone, select **Record Voice Profile**, and
speak naturally in several phrases for 20–30 seconds. The meter and quality
summary report usable speech, clipping, silence, and noise. Raw enrollment PCM
is held only in memory and cleared after processing; only the consolidated
embedding and calibration metadata are saved with Electron OS-backed encryption.

Run **Test Voice Detection** several times before enabling **Ignore My Voice**.
The displayed cosine score is a model similarity value, not an accuracy
percentage. Test recordings never enter OpenAI, Azure, Whisper, or the normal AI
pipeline.

## Audio routing and failure behavior

Both the physical microphone and Windows system-playback capture are normalized
to 16 kHz mono PCM16 even when the device AudioContext uses another rate. When
filtering is enabled, every desktop provider uses the same route:

```text
desktop PCM → local VAD/utterance buffer → SpeechBrain verification
            ├─ SELF_MATCH → discard
            ├─ UNCERTAIN / INSUFFICIENT_AUDIO / MODEL_FAILURE → hold or discard
            └─ OTHER_SPEAKER → OpenAI, Azure, or local Whisper
```

The opening audio remains buffered until the decision allows it. The gate resets
at speech-turn boundaries and periodically rechecks long turns. Stopping a
session invalidates delayed results and clears pending PCM. If the model crashes,
times out, or becomes unavailable, filtering fails closed and no pending desktop
audio is sent until the model recovers or the filter is explicitly disabled.

System playback normally captures the other party without opening the physical
microphone. It can still contain your voice through conference monitoring or
loopback, so test that route separately. Overlapping voices cannot be perfectly
separated by a single-speaker embedding; mixed or inconsistent windows are
treated conservatively as uncertain and may block other-speaker speech.

## Diagnostics and troubleshooting

Run `npm run test-speaker` for automated coverage. For real-audio validation,
first enroll in Settings, record uncompressed 16 kHz mono PCM16 WAV samples
through the exact microphone and playback routes you use, then run:

```powershell
npm run voice-diagnostic -- --self me-near.wav --self me-far.wav --other consenting-speaker.wav --system call-playback.wav
```

Use `npm run voice-diagnostic -- --health-only` to verify automatic user-data,
Python, model, dependency, and real-inference discovery without a recording.

The diagnostic prints received frame counts, decisions, similarity values,
quality warnings, uncertainty rate, and classification latency. Test multiple
distances and volumes, background noise, pauses, and alternating consenting
speakers.

If model setup fails, use **Install / Repair** and review its progress text. If
Python cannot be found, install Python 3.12 with the Windows `py` launcher. If
microphones are missing, grant microphone permission in Windows Privacy settings
and reopen Settings. If system playback returns no audio, ensure the shared app
is playing through the selected Windows output and reselect the capture source.

The following phone-microphone design is retained only as an archived record.

<!-- Legacy phone-microphone design (disabled and not exposed by the app).

YashOpenClue can enroll a consenting user's voice on the phone and use a local
speaker-verification gate to ignore probable matches before phone audio reaches
transcription or an LLM. The feature protects the **phone microphone path only**;
desktop microphone and system-audio capture are separate sources.

Speaker verification is probabilistic. A strict threshold reduces the chance
that the enrolled speaker is passed through, but can also block another person.
`UNCERTAIN`, invalid audio, missing-profile, timeout, and model-failure results
are fail-closed while the filter is enabled. If guaranteed exclusion is needed,
do not capture that microphone source.

## Install the pinned local model

The app does not silently download a speaker model. From PowerShell, run:

```powershell
.\scripts\setup-speaker-model.ps1 -UserData "$env:APPDATA\OpenCluely"
```

The script creates an isolated Python environment and explicitly downloads
SpeechBrain 1.0.3 plus `speechbrain/spkrec-ecapa-voxceleb` at revision
`0f99f2d0ebe89ac095bcc5903c4dd8f72b367286`. Copy the two paths printed by the
script into the desktop `.env`:

```dotenv
SPEAKER_PYTHON=C:\path\to\speaker-python\Scripts\python.exe
SPEAKER_MODEL_DIR=C:\path\to\spkrec-ecapa-voxceleb-0f99f2d
```

The model expects 16 kHz mono audio. Inference runs in a bounded, timeout-
protected Python subprocess, not Electron's main event loop.

## Secure phone transport

Enrollment, testing, and filtered phone listening are refused over plain LAN
HTTP. Install a certificate trusted by both the desktop and phone (for example,
with a locally managed CA), then configure:

```dotenv
MOBILE_TLS_CERT=C:\path\to\desktop-lan.crt
MOBILE_TLS_KEY=C:\path\to\desktop-lan.key
```

Restart the desktop and pair using the displayed `https://` address. Credentials
remain in the Authorization header and are never placed in URLs.

## Use and data handling

Open mobile **Settings → Voice Recognition**, choose **Set Up My Voice**, and
record at least 20 seconds of useful speech. Review the quality summary, analyze,
then use **Test Recognition** before enabling **Ignore My Voice**. The same screen
can re-record or delete the profile.

Enrollment PCM is held temporarily in desktop memory and cleared after analysis
or cancellation. Raw audio is not persisted. The aggregate embedding, model
revision, thresholds, date, and quality statistics are encrypted with Electron's
OS-backed secure storage under the app user-data directory. If secure storage is
unavailable, the profile is not saved. Embeddings and raw recordings are never
returned by the mobile status API or written to logs.

```text
Enrollment:
Phone mic → trusted WSS → memory-only VAD/quality checks
          → pinned ECAPA worker → consistency check/aggregate embedding
          → OS-encrypted profile (raw PCM discarded)

Filtered listening:
Phone mic → trusted WSS → local VAD → opening-audio buffer
          → ECAPA comparison ─┬─ SELF_MATCH → discard
                              ├─ UNCERTAIN/error → discard (fail closed)
                              └─ OTHER_SPEAKER → existing transcription → Q&A
```

Thresholds are calibrated from the enrollment windows around SpeechBrain's
documented cosine-comparison method; they are not accuracy percentages. Real-
world evaluation with multiple consenting speakers, phone positions, volumes,
and noise conditions is still required for each deployment.
-->


## Persistent conversations, images, and manual listening

Desktop and phone share SQLite-backed context for speech, typed questions,
images, and screenshots. New Chat keeps saved history and the selected mode.
Use History to continue or delete a conversation; Settings has a separate,
confirmed Clear all history action.

Press **Start Listening**, speak for as long as needed, and press the green
**Send** button to stop capture, finalize the transcript, and submit one question.
Pauses do not submit questions. Transcription providers may process fixed-size
chunks internally to bound memory; model submission is controlled by Send.
The backtick listening shortcut is preserved. It starts/pauses capture; use Send
to submit. Both the phone and desktop toolbar expose the green Send control.

Normal uses `gpt-6-luna` with `low` reasoning. STAR Behavioral uses `gpt-6.1-sol`
with `medium` reasoning and detailed, story-driven Situation / Task / Action / Result instructions (typically 450–700 words, with Action receiving the most depth).
Technical questions stay direct. Change modes in the desktop toolbar or phone
chat. Legacy `OPENAI_MODEL` / `OPENAI_IMAGE_MODEL` variables do not override this
shared Q&A pipeline.

Attach up to four PNG/JPEG/WebP images (10 MB and 24 megapixels each) from the phone
library. Tap saved thumbnails to enlarge them. Original images remain available
for visual follow-ups. Settings exposes lightweight microphone diagnostics.

Run `npm install` and `npm --prefix mobile install` after updating, restart the
desktop, and restart Expo. For a custom native mobile build, rebuild once for
`expo-image-picker`; Expo Go includes the image picker. No new API credentials
are required. SQLite migrates automatically without deleting saved messages.

See [PHASE2-IMPLEMENTATION.md](PHASE2-IMPLEMENTATION.md) for endpoints, migrations,
validation results, changed files, and remaining device checks.


STAR interview preparation uses the current saved resume and confirmed conversation
facts. Desktop Settings and the phone show whether resume context is loaded.
Contact fields are omitted from model context, and resume text is treated as data.
The target role defaults to Software Engineering Intern; provide a target company
or job description in chat to tailor the answer. No separate story-bank setup is
required. See [STAR-SWE-REPORT.md](STAR-SWE-REPORT.md) for research, evaluations,
examples, and limits. Run `npm run test:swe` for the focused checks or
`npm run evaluate:swe` for an explicit paid evaluation using the saved resume.


## Capital One TIP Case mode

Select **Case** beside Normal/STAR on the phone or in the desktop mode selector.
It uses `gpt-6.1-sol` with `medium` reasoning for structured case analysis,
readable calculations, code traces, engineering tradeoffs, and a supported
recommendation. It retains case facts for follow-ups and works with voice,
manual green Send, text, images, and screenshots. Case does not apply STAR story
formatting or personal-project preferences, and it omits the separate resume block.

Normal remains Luna Low; STAR remains Sol Medium. Modes synchronize and persist;
switching does not clear history or change audio capture. Restart Electron and
reload Expo after updating. See [CASE-MODE-REPORT.md](CASE-MODE-REPORT.md) for the
public research sources, exact scope, live checks, and limitations.

Run `npm run test:case` for focused tests. `npm run test:live-case` performs optional
paid API checks on synthetic cases, without changing saved user conversations.


Responses now use plain prose in all modes, including saved history and streaming
answers. Decorative Markdown bold markers, heading hashes, and bullet prefixes
are removed for display; code syntax, arithmetic, negative values, and ordinary
hyphenated words are preserved. Stored message contents are not rewritten.
Restart the desktop app and Expo after updating the shared display formatter.
