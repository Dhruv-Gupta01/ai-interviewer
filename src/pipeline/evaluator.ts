import Groq from "groq-sdk";
import type { InterviewConfig } from "./prompt-builder";

export interface TranscriptTurn {
  speaker: "interviewer" | "candidate";
  text: string;
}

export interface CompetencyScore {
  score: number; // 1–5
  notes: string;
}

export interface EvaluationReport {
  recommendation: "Strong Hire" | "Hire" | "Lean No Hire" | "No Hire";
  summary: string;
  scores: Record<string, CompetencyScore>;
  strengths: string[];
  concerns: string[];
  highlights: { quote: string; label: string }[];
  interviewedFor: string;
  interviewType: string;
  generatedAt: string;
}

// Competencies to assess per interview type
const COMPETENCIES: Record<string, string[]> = {
  behavioral: ["communication", "leadership", "culture_fit", "problem_ownership", "self_awareness"],
  dsa: ["algorithmic_thinking", "problem_solving", "code_quality", "complexity_analysis", "edge_case_handling"],
  "system-design": ["architecture", "scalability", "trade_off_analysis", "component_design", "communication"],
  "domain-technical": ["technical_depth", "practical_experience", "problem_solving", "best_practices", "communication"],
};

const COMPETENCY_LABELS: Record<string, string> = {
  communication: "Communication",
  leadership: "Leadership & Ownership",
  culture_fit: "Culture Fit",
  problem_ownership: "Problem Ownership",
  self_awareness: "Self Awareness",
  algorithmic_thinking: "Algorithmic Thinking",
  problem_solving: "Problem Solving",
  code_quality: "Code Quality",
  complexity_analysis: "Complexity Analysis",
  edge_case_handling: "Edge Case Handling",
  architecture: "Architecture Design",
  scalability: "Scalability Thinking",
  trade_off_analysis: "Trade-off Analysis",
  component_design: "Component Design",
  technical_depth: "Technical Depth",
  practical_experience: "Practical Experience",
  best_practices: "Best Practices",
};

export async function generateEvaluation(
  groqKey: string,
  config: InterviewConfig,
  transcript: TranscriptTurn[]
): Promise<EvaluationReport> {
  const groq = new Groq({ apiKey: groqKey });

  const competencies = COMPETENCIES[config.interviewType] || COMPETENCIES["domain-technical"];

  const transcriptText = transcript
    .map((t) => `${t.speaker === "interviewer" ? "INTERVIEWER" : "CANDIDATE"}: ${t.text}`)
    .join("\n");

  const competencyList = competencies
    .map((c) => `"${c}": { "score": <1-5>, "notes": "<1-2 sentence justification>" }`)
    .join(",\n    ");

  const prompt = `You are a senior engineering hiring manager. You just observed this ${config.interviewType} interview for a ${config.role} position.

${config.jd.trim() ? `JOB DESCRIPTION:\n${config.jd.substring(0, 1500)}\n` : ""}
${config.resumeText?.trim() ? `CANDIDATE RESUME SUMMARY:\n${config.resumeText.substring(0, 1000)}\n` : ""}

FULL INTERVIEW TRANSCRIPT:
${transcriptText}

Based ONLY on what the candidate said in this transcript, generate a structured evaluation. Be honest and calibrated — not every candidate is a "Hire". If the candidate barely spoke or gave weak answers, reflect that.

Respond with ONLY valid JSON in this exact structure:
{
  "recommendation": "<Strong Hire | Hire | Lean No Hire | No Hire>",
  "summary": "<2-3 sentence overall assessment>",
  "scores": {
    ${competencyList}
  },
  "strengths": ["<specific strength with evidence>", "<another strength>"],
  "concerns": ["<specific concern with evidence>", "<another concern>"],
  "highlights": [
    { "quote": "<verbatim or near-verbatim quote from candidate>", "label": "<Strong answer | Struggled | Red flag | Good insight>" }
  ]
}

Rules:
- scores must be integers 1-5 (1=very poor, 3=average, 5=exceptional)
- strengths and concerns: 2-4 items each, grounded in specific things the candidate said
- highlights: pick 2-4 notable moments (strong or weak)
- Do NOT invent things the candidate didn't say
- Recommendation must match the scores — don't give "Strong Hire" if scores are 3/5 across the board`;

  let raw = "";

  const stream = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3, // low temp for structured output
    max_tokens: 1200,
    stream: true,
  });

  for await (const chunk of stream) {
    raw += chunk.choices[0]?.delta?.content || "";
  }

  // Extract JSON from response (LLM sometimes wraps in ```json ... ```)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM did not return valid JSON evaluation");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Normalise scores — replace keys with labelled versions
  const normalisedScores: Record<string, CompetencyScore> = {};
  for (const key of competencies) {
    if (parsed.scores?.[key]) {
      const label = COMPETENCY_LABELS[key] || key;
      normalisedScores[label] = {
        score: Math.min(5, Math.max(1, parseInt(parsed.scores[key].score) || 3)),
        notes: parsed.scores[key].notes || "",
      };
    }
  }

  return {
    recommendation: parsed.recommendation || "Lean No Hire",
    summary: parsed.summary || "",
    scores: normalisedScores,
    strengths: parsed.strengths || [],
    concerns: parsed.concerns || [],
    highlights: parsed.highlights || [],
    interviewedFor: config.role,
    interviewType: config.interviewType,
    generatedAt: new Date().toISOString(),
  };
}
