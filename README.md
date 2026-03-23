# AI Interviewer

A voice-based AI interview platform for internal hiring pipelines. The AI conducts real, live interviews — asking questions, listening to responses, following up, and generating a structured evaluation report at the end.

No pre-recorded questions. No scripts. A genuine back-and-forth conversation powered by speech-to-text, an LLM, and text-to-speech.

---

## Demo

| Setup | Interview Room (DSA) | Evaluation Report |
|---|---|---|
| Role, JD, resume upload | Live code editor + voice | Scores, recommendation, highlights |

---

## Features

- **Voice pipeline** — Mic → Deepgram STT → Groq LLM → Deepgram TTS → Speaker. Sub-second latency.
- **Role-aware prompting** — AI calibrates difficulty and question style based on role (Intern → Staff) and interview type
- **Resume personalisation** — Upload PDF or DOCX. AI reads it and asks about specific projects and claimed skills
- **Live code editor** — Monaco editor (VS Code's engine) for DSA rounds. AI sees the candidate's code and comments on it
- **Whiteboard** — Fabric.js canvas for system design rounds. Pen, shapes, arrows, text, colours, undo
- **Evaluation report** — Post-interview LLM analysis: recommendation (Strong Hire → No Hire), competency scores with justification, strengths, concerns, and notable quotes from the transcript
- **Admin dashboard** — Create shareable interview links pre-configured with role/JD/type/duration. Links have expiry and track usage
- **Auth** — JWT-based session, credentials via environment variables

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | [Bun](https://bun.sh) | Built-in TypeScript, WebSocket server, SQLite — no extra deps |
| STT | [Deepgram](https://deepgram.com) nova-3 | Raw WebSocket, best accuracy/latency ratio, $200 free credit |
| LLM | [Groq](https://groq.com) llama-3.3-70b | Fast inference, generous free tier (30 RPM) |
| TTS | [Deepgram](https://deepgram.com) Aura-2 | Same provider as STT, raw fetch, natural voice |
| Code editor | [Monaco](https://microsoft.github.io/monaco-editor/) via CDN | VS Code's editor, zero bundling needed |
| Whiteboard | [Fabric.js](http://fabricjs.com/) via CDN | Full canvas manipulation, single script tag |
| Database | Bun SQLite (`bun:sqlite`) | Zero-dep, built into Bun, perfect for interview links |
| Deploy | [Railway](https://railway.app) | Native Bun support, one-click from GitHub |

---

## Architecture

```
Browser
  │
  ├── Mic audio (Int16 PCM) ──────────────────► WebSocket ──► Deepgram STT
  │                                                                │
  │                                                          final transcript
  │                                                                │
  │                                                         Groq LLM (stream)
  │                                                                │
  │                                                       Deepgram TTS (per sentence)
  │                                                                │
  ◄── Audio chunks (Int16 PCM) ◄──────────────────────── WebSocket ◄─┘
  │
  └── Code updates (debounced) ────────────────► WebSocket ──► injected into LLM context
```

**Interview types and what they activate:**

| Type | Extra UI | AI Behaviour |
|---|---|---|
| Behavioral | — | STAR method, past experiences |
| Domain Technical | — | Deep tech Q&A on JD skills |
| DSA / Coding | Monaco code editor | Sees candidate's code, probes complexity |
| System Design | Fabric.js whiteboard | Design questions, trade-off probing |

---

## Project Structure

```
src/
├── client/
│   ├── index.html        # Main interview app (setup → lobby → room)
│   ├── admin.html        # Admin dashboard — create/manage interview links
│   └── login.html        # Login page
├── pipeline/
│   ├── stt.ts            # Deepgram STT via raw WebSocket
│   ├── llm.ts            # Groq LLM with conversation history
│   ├── tts.ts            # Deepgram TTS via raw fetch, streaming per sentence
│   ├── orchestrator.ts   # Wires STT → LLM → TTS, manages queue
│   ├── prompt-builder.ts # Dynamic system prompt from role + JD + resume
│   └── evaluator.ts      # Post-interview evaluation report generator
└── server/
    ├── index.ts          # Bun HTTP + WebSocket server, all routes
    ├── auth.ts           # JWT sign/verify (Web Crypto, zero deps)
    └── db.ts             # SQLite — interview link CRUD
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- [Deepgram](https://deepgram.com) API key (free $200 credit)
- [Groq](https://console.groq.com) API key (free)

### Setup

```bash
# Clone and install
git clone https://github.com/Dhruv-Gupta01/ai-interviewer
cd ai-interviewer
bun install

# Configure environment
cp .env.example .env
# Edit .env with your keys
```

### Environment Variables

```env
# Required
DEEPGRAM_API_KEY=your_deepgram_key
GROQ_API_KEY=your_groq_key

# Auth (change these)
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=yourpassword
JWT_SECRET=a-long-random-secret-string

# Optional
PORT=3000
```

### Run

```bash
bun run dev     # development (hot reload)
bun run start   # production
```

Open http://localhost:3000

---

## Usage

### As an interviewer (HR / Admin)

1. Go to `/admin` → log in
2. Fill in role, interview type, duration, and optionally paste the JD
3. Click **Generate Interview Link**
4. Send the link to the candidate

### As a candidate

1. Open the interview link
2. Allow camera and microphone access
3. Click **Join Interview**
4. Talk naturally — the AI will ask questions, listen, and follow up
5. When done, the session auto-generates an evaluation report

### Direct access

Go to `/` to reach the setup screen and configure an interview manually (no link needed).

---

## Deployment (Railway)

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select this repo
4. Add the environment variables from above in the Railway dashboard
5. Railway auto-detects Bun and uses `railway.toml` for the start command

> **Note:** The SQLite database (`data.sqlite`) lives on the container filesystem. It persists between redeploys but resets on full container replacement. Swap to Postgres for production persistence.

---

## Roadmap

- [x] M0 — Speech pipeline (STT → LLM → TTS)
- [x] M1 — Google Meet-style interview room UI
- [x] M2 — Role + JD context with dynamic prompts
- [x] M3 — Resume personalisation (PDF/DOCX)
- [x] M5 — Live code editor for DSA rounds
- [x] M6 — Whiteboard for system design rounds
- [x] M8 — Post-interview evaluation report
- [x] M9 — Admin dashboard + shareable interview links (minimal)
- [ ] M4 — AI avatar (animated)
- [ ] M7 — Full interview recording + timestamped transcript
- [ ] M9 full — Hiring manager dashboard, candidate pipeline, side-by-side comparison

---

## License

MIT
