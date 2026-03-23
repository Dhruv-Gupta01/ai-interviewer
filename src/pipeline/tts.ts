export class TTSService {
  constructor(private apiKey: string) {}

  async synthesize(text: string): Promise<Buffer> {
    const start = performance.now();
    console.log(`[TTS] Synthesizing: "${text.substring(0, 80)}..."`);

    const response = await fetch(
      "https://api.deepgram.com/v1/speak?model=aura-2-andromeda-en&encoding=linear16&sample_rate=24000&container=none",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[TTS] API error ${response.status}: ${errorText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    const elapsed = performance.now() - start;
    console.log(
      `[TTS] Synthesized ${audioBuffer.length} bytes in ${elapsed.toFixed(0)}ms`
    );

    return audioBuffer;
  }

  async *synthesizeStreaming(
    text: string
  ): AsyncGenerator<Buffer, void, unknown> {
    const sentences = this.splitIntoSentences(text);

    for (const sentence of sentences) {
      if (sentence.trim()) {
        const audio = await this.synthesize(sentence);
        yield audio;
      }
    }
  }

  private splitIntoSentences(text: string): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    return sentences || [text];
  }
}
