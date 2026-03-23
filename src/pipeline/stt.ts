import WebSocket from "ws";

export interface STTEvents {
  onPartialTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onError: (error: Error) => void;
}

export class STTService {
  private ws: WebSocket | null = null;

  constructor(private apiKey: string) {}

  async startStreaming(events: STTEvents): Promise<void> {
    const url = `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=true&utterance_end_ms=1500&vad_events=true&endpointing=500`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.apiKey}`,
        },
      });

      this.ws = ws;

      // Accumulate final transcripts until utterance ends
      let accumulatedText = "";

      const timeout = setTimeout(() => {
        reject(new Error("[STT] Connection timeout after 10s"));
        ws.close();
      }, 10000);

      ws.on("open", () => {
        clearTimeout(timeout);
        console.log("[STT] Connection opened");
        resolve();
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "Results") {
            const transcript =
              message.channel?.alternatives?.[0]?.transcript;
            if (!transcript || transcript.trim() === "") return;

            if (message.is_final) {
              // Accumulate final segments
              accumulatedText += (accumulatedText ? " " : "") + transcript;
              console.log(`[STT] Segment (is_final): "${transcript}"`);

              if (message.speech_final) {
                // speech_final = definite end of utterance
                console.log(
                  `[STT] Final transcript (speech_final): "${accumulatedText}"`
                );
                events.onFinalTranscript(accumulatedText);
                accumulatedText = "";
              }
            } else {
              // Show partial + any accumulated text
              const display = accumulatedText
                ? accumulatedText + " " + transcript
                : transcript;
              events.onPartialTranscript(display);
            }
          } else if (message.type === "UtteranceEnd") {
            // Backup trigger — if we have accumulated text that never got speech_final
            if (accumulatedText.trim()) {
              console.log(
                `[STT] Final transcript (utterance_end): "${accumulatedText}"`
              );
              events.onFinalTranscript(accumulatedText);
              accumulatedText = "";
            }
          } else if (message.type === "Metadata") {
            console.log(
              `[STT] Connected: request_id=${message.request_id}`
            );
          }
        } catch (err) {
          console.error("[STT] Failed to parse message:", err);
        }
      });

      ws.on("error", (err: Error) => {
        clearTimeout(timeout);
        console.error("[STT] WebSocket error:", err.message);
        events.onError(err);
        reject(err);
      });

      ws.on("close", (code: number, reason: Buffer) => {
        console.log(
          `[STT] Connection closed: code=${code} reason=${reason.toString()}`
        );
      });
    });
  }

  sendAudio(audioData: Buffer | ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(audioData);
  }

  async stop(): Promise<void> {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      }
      this.ws.close();
      this.ws = null;
    }
  }
}
