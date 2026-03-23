import Groq from "groq-sdk";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LLMService {
  private client: Groq;
  private history: ChatMessage[] = [];

  constructor(private apiKey: string) {
    this.client = new Groq({ apiKey: this.apiKey });
  }

  startSession(systemPrompt: string): void {
    this.history = [{ role: "system", content: systemPrompt }];
    console.log(
      `[LLM] Session started (prompt length: ${systemPrompt.length} chars)`
    );
  }

  async generateResponse(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    const start = performance.now();
    console.log(`[LLM] Generating response for: "${userMessage}"`);

    const completion = await this.client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: this.history,
      temperature: 0.7,
      max_tokens: 300,
    });

    const response = completion.choices[0]?.message?.content || "";
    this.history.push({ role: "assistant", content: response });

    const elapsed = performance.now() - start;
    console.log(
      `[LLM] Response generated (${elapsed.toFixed(0)}ms): "${response.substring(0, 100)}..."`
    );

    return response;
  }

  async *generateResponseStream(
    userMessage: string
  ): AsyncGenerator<string, void, unknown> {
    this.history.push({ role: "user", content: userMessage });

    const start = performance.now();
    let firstChunk = true;
    let fullResponse = "";
    console.log(`[LLM] Streaming response for: "${userMessage}"`);

    const stream = await this.client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: this.history,
      temperature: 0.7,
      max_tokens: 300,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        if (firstChunk) {
          console.log(
            `[LLM] First chunk in ${(performance.now() - start).toFixed(0)}ms`
          );
          firstChunk = false;
        }
        fullResponse += text;
        yield text;
      }
    }

    this.history.push({ role: "assistant", content: fullResponse });

    console.log(
      `[LLM] Stream complete in ${(performance.now() - start).toFixed(0)}ms`
    );
  }
}
