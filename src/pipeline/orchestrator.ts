import { STTService } from "./stt";
import { LLMService } from "./llm";
import { TTSService } from "./tts";
import {
  buildSystemPrompt,
  type InterviewConfig,
} from "./prompt-builder";

export interface OrchestratorEvents {
  onPartialTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onAIResponseText: (text: string) => void;
  onAIAudioChunk: (audio: Buffer) => void;
  onAIResponseComplete: () => void;
  onError: (error: Error) => void;
}

export class PipelineOrchestrator {
  private stt: STTService;
  private llm: LLMService;
  private tts: TTSService;
  private isProcessing = false;
  private pendingQueue: string[] = [];
  private events: OrchestratorEvents | null = null;
  private config: InterviewConfig | null = null;
  private currentCode: string = "";
  private codeLanguage: string = "javascript";

  constructor(deepgramKey: string, groqKey: string) {
    this.stt = new STTService(deepgramKey);
    this.llm = new LLMService(groqKey);
    this.tts = new TTSService(deepgramKey);
  }

  setConfig(config: InterviewConfig): void {
    this.config = config;
    console.log(
      `[Orchestrator] Config set: role=${config.role}, type=${config.interviewType}, duration=${config.durationMinutes}min`
    );
  }

  async start(events: OrchestratorEvents): Promise<void> {
    this.events = events;

    // Build dynamic system prompt from interview config
    const systemPrompt = this.config
      ? buildSystemPrompt(this.config)
      : buildSystemPrompt({
          role: "Software Engineer",
          jd: "",
          interviewType: "behavioral",
          durationMinutes: 45,
        });

    this.llm.startSession(systemPrompt);

    await this.stt.startStreaming({
      onPartialTranscript: (text) => {
        events.onPartialTranscript(text);
      },
      onFinalTranscript: (text) => {
        events.onFinalTranscript(text);
        // Don't await — queue it so the STT callback returns immediately
        this.queueUserSpeech(text);
      },
      onError: (error) => {
        events.onError(error);
      },
    });

    console.log("[Orchestrator] STT connected, generating AI intro...");

    // Generate the AI's opening line (non-blocking — runs in background)
    this.queueUserSpeech(
      "The interview is starting now. Please introduce yourself and begin the interview."
    );

    console.log("[Orchestrator] Pipeline started");
  }

  private queueUserSpeech(text: string): void {
    console.log(
      `[Orchestrator] queueUserSpeech called. isProcessing=${this.isProcessing}, queueLength=${this.pendingQueue.length}`
    );
    if (this.isProcessing) {
      console.log(`[Orchestrator] Queuing: "${text.substring(0, 50)}..."`);
      this.pendingQueue.push(text);
      return;
    }
    this.processUserSpeech(text);
  }

  private async processUserSpeech(text: string): Promise<void> {
    this.isProcessing = true;
    const pipelineStart = performance.now();

    try {
      // For DSA interviews, inject the current code state into the message
      let messageForLLM = text;
      if (
        this.config?.interviewType === "dsa" &&
        this.currentCode.trim()
      ) {
        messageForLLM = `${text}\n\n[CANDIDATE'S CURRENT CODE (${this.codeLanguage})]:\n${this.currentCode}`;
        console.log(
          `[Orchestrator] Injected code context (${this.currentCode.length} chars)`
        );
      }

      // Step 1: Get LLM response (streaming)
      let fullResponse = "";

      for await (const chunk of this.llm.generateResponseStream(messageForLLM)) {
        fullResponse += chunk;
      }

      this.events?.onAIResponseText(fullResponse);

      // Step 2: Convert to speech (sentence-by-sentence for parallelism)
      for await (const audioChunk of this.tts.synthesizeStreaming(
        fullResponse
      )) {
        this.events?.onAIAudioChunk(audioChunk);
      }

      const totalTime = performance.now() - pipelineStart;
      console.log(
        `[Orchestrator] Full pipeline completed in ${totalTime.toFixed(0)}ms`
      );

      this.events?.onAIResponseComplete();
    } catch (error) {
      console.error("[Orchestrator] Pipeline error:", error);
      this.events?.onError(
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      this.isProcessing = false;

      // Process next in queue if any
      if (this.pendingQueue.length > 0) {
        const next = this.pendingQueue.shift()!;
        console.log(
          `[Orchestrator] Processing queued: "${next.substring(0, 50)}..."`
        );
        this.processUserSpeech(next);
      }
    }
  }

  updateCode(code: string, language: string): void {
    this.currentCode = code;
    this.codeLanguage = language;
  }

  sendAudio(audioData: Buffer | ArrayBuffer): void {
    this.stt.sendAudio(audioData);
  }

  async stop(): Promise<void> {
    await this.stt.stop();
    this.pendingQueue = [];
    console.log("[Orchestrator] Pipeline stopped");
  }
}
