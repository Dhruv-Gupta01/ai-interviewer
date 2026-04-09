import { PipelineOrchestrator } from "../pipeline/orchestrator";
import type { InterviewConfig } from "../pipeline/prompt-builder";
import { generateEvaluation } from "../pipeline/evaluator";
import type { TranscriptTurn } from "../pipeline/evaluator";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { signJWT, verifyJWT, getSessionToken, requireAuth } from "./auth";
import { createLink, getLink, markLinkUsed, listLinks, deleteLink } from "./db";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@yourdomain.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_in_prod";

if (!DEEPGRAM_API_KEY || !GROQ_API_KEY) {
  console.error("Missing API keys. Set DEEPGRAM_API_KEY and GROQ_API_KEY in .env");
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || "3000");

const sessions = new Map<string, { orchestrator: PipelineOrchestrator; started: boolean }>();

// ─── Helper: serve an HTML file ───────────────────────
async function serveHtml(path: string): Promise<Response> {
  const html = await Bun.file(path).text();
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

// ─── Main server ──────────────────────────────────────
const server = Bun.serve<{ sessionId: string }>({
  port: PORT,
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ── Public: login page ──
    if (path === "/login") {
      return serveHtml("src/client/login.html");
    }

    // ── Auth: POST /api/login ──
    if (path === "/api/login" && req.method === "POST") {
      const body = await req.json() as { email: string; password: string };
      if (body.email === ADMIN_EMAIL && body.password === ADMIN_PASSWORD) {
        const token = await signJWT({ role: "admin", email: body.email }, JWT_SECRET);
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`,
          },
        });
      }
      return json({ error: "Invalid email or password" }, 401);
    }

    // ── Auth: POST /api/logout ──
    if (path === "/api/logout" && req.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        },
      });
    }

    // ── Admin page (protected) ──
    if (path === "/admin") {
      if (!(await requireAuth(req, JWT_SECRET))) return redirect("/login");
      return serveHtml("src/client/admin.html");
    }

    // ── Admin API: list links ──
    if (path === "/api/links" && req.method === "GET") {
      if (!(await requireAuth(req, JWT_SECRET))) return json({ error: "Unauthorized" }, 401);
      return json(listLinks());
    }

    // ── Admin API: create link ──
    if (path === "/api/links" && req.method === "POST") {
      if (!(await requireAuth(req, JWT_SECRET))) return json({ error: "Unauthorized" }, 401);
      const body = await req.json() as { config: InterviewConfig; label: string; ttlHours: number };
      const link = createLink(body.config, body.label || "Unnamed", body.ttlHours || 72);
      console.log(`[Server] Link created: ${link.token} — ${link.label}`);
      return json(link);
    }

    // ── Admin API: delete link ──
    if (path.startsWith("/api/links/") && req.method === "DELETE") {
      if (!(await requireAuth(req, JWT_SECRET))) return json({ error: "Unauthorized" }, 401);
      const token = path.split("/api/links/")[1];
      deleteLink(token);
      return json({ ok: true });
    }

    // ── Candidate interview link entry point ──
    if (path.startsWith("/i/")) {
      const token = path.split("/i/")[1];
      const link = getLink(token);
      const now = Math.floor(Date.now() / 1000);

      if (!link) {
        return new Response("Interview link not found.", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      if (link.expiresAt < now) {
        return new Response("This interview link has expired.", { status: 410, headers: { "Content-Type": "text/plain" } });
      }

      // Mark as used on first visit
      if (!link.usedAt) markLinkUsed(token);

      // Serve the main app with the config pre-embedded, setup hidden, lobby shown
      let html = await Bun.file("src/client/index.html").text();
      const configScript = `<script>window.__INTERVIEW_CONFIG__ = ${JSON.stringify(link.config)};</script>`;
      html = html.replace("</head>", `${configScript}\n</head>`);
      // Swap active screen: hide setup, show lobby directly
      html = html.replace('id="setup" class="screen active"', 'id="setup" class="screen"');
      html = html.replace('id="lobby" class="screen"', 'id="lobby" class="screen active"');
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // ── Main app (direct access — goes to setup screen as before) ──
    if (path === "/" || path === "/index.html") {
      return serveHtml("src/client/index.html");
    }

    // ── Evaluation report generation ──
    if (path === "/evaluate" && req.method === "POST") {
      try {
        const body = await req.json() as { transcript: TranscriptTurn[]; config: InterviewConfig };
        if (!body.transcript?.length) return json({ error: "No transcript provided" }, 400);

        console.log(`[Server] Generating evaluation — ${body.transcript.length} turns, role=${body.config?.role}`);
        const report = await generateEvaluation(GROQ_API_KEY!, body.config, body.transcript);
        console.log(`[Server] Evaluation complete: ${report.recommendation}`);
        return json(report);
      } catch (err: any) {
        console.error("[Server] Evaluation error:", err?.message);
        return json({ error: err?.message || "Evaluation failed" }, 500);
      }
    }

    // ── Resume upload + parse ──
    if (path === "/upload-resume" && req.method === "POST") {
      try {
        const formData = await req.formData();
        const file = formData.get("resume") as File | null;
        if (!file) return json({ error: "No file provided" }, 400);

        const buffer = Buffer.from(await file.arrayBuffer());
        let text = "";

        if (file.name.toLowerCase().endsWith(".pdf")) {
          const parser = new PDFParse({ data: buffer });
          const result = await parser.getText();
          text = result.text;
        } else if (file.name.toLowerCase().endsWith(".docx")) {
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
        } else {
          return json({ error: "Only PDF and DOCX files are supported" }, 400);
        }

        text = text.replace(/\s{3,}/g, "\n\n").trim();
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        console.log(`[Server] Resume parsed: ${file.name} — ${wordCount} words`);
        return json({ text, wordCount });
      } catch (err: any) {
        console.error("[Server] Resume parse error:", err?.message);
        return json({ error: "Failed to parse resume" }, 500);
      }
    }

    // ── WebSocket upgrade ──
    if (path === "/ws") {
      const upgraded = server.upgrade(req, { data: { sessionId: crypto.randomUUID() } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined;
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const sessionId = ws.data.sessionId;
      console.log(`[Server] New session: ${sessionId}`);
      const orchestrator = new PipelineOrchestrator(DEEPGRAM_API_KEY!, GROQ_API_KEY!);
      sessions.set(sessionId, { orchestrator, started: false });
      ws.send(JSON.stringify({ type: "ready" }));
    },

    async message(ws, message) {
      const sessionId = ws.data.sessionId;
      const session = sessions.get(sessionId);
      if (!session) return;

      const { orchestrator } = session;

      if (message instanceof ArrayBuffer || message instanceof Buffer) {
        if (session.started) {
          orchestrator.sendAudio(message instanceof ArrayBuffer ? Buffer.from(message) : message);
        }
        return;
      }

      try {
        const data = JSON.parse(message as string);

        if (data.type === "start_interview") {
          const config: InterviewConfig = {
            role: data.config?.role || "Software Engineer",
            jd: data.config?.jd || "",
            interviewType: data.config?.interviewType || "behavioral",
            durationMinutes: data.config?.durationMinutes || 45,
            resumeText: data.config?.resumeText || "",
          };
          orchestrator.setConfig(config);

          try {
            await orchestrator.start({
              onPartialTranscript: (text) => ws.send(JSON.stringify({ type: "partial_transcript", text })),
              onFinalTranscript: (text) => ws.send(JSON.stringify({ type: "final_transcript", text })),
              onAIResponseText: (text) => ws.send(JSON.stringify({ type: "ai_response_text", text })),
              onAIAudioChunk: (audio) => ws.send(audio),
              onAIResponseComplete: () => ws.send(JSON.stringify({ type: "ai_response_complete" })),
              onError: (error) => ws.send(JSON.stringify({ type: "error", message: error.message })),
            });
            session.started = true;
          } catch (error: any) {
            console.error("[Server] Failed to start pipeline:", error?.message);
            try { ws.send(JSON.stringify({ type: "error", message: error?.message || "Failed to start" })); } catch {}
          }
        } else if (data.type === "code_update") {
          orchestrator.updateCode(data.code || "", data.language || "javascript");
        } else if (data.type === "stop") {
          orchestrator.stop();
          sessions.delete(sessionId);
        }
      } catch {
        console.warn("[Server] Invalid message");
      }
    },

    async close(ws) {
      const sessionId = ws.data.sessionId;
      const session = sessions.get(sessionId);
      if (session) {
        await session.orchestrator.stop();
        sessions.delete(sessionId);
      }
      console.log(`[Server] Session ${sessionId} closed`);
    },
  },
});

console.log(`
🎙️  AI Interview Platform running on http://localhost:${PORT}

   Admin:  http://localhost:${PORT}/admin
   Login:  http://localhost:${PORT}/login
   Pipeline: Mic → Deepgram STT → Groq LLM → Deepgram TTS → Speaker
`);
