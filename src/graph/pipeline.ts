import model from "@/lib/model";
import {
  Annotation,
  MessagesAnnotation,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Pipeline state — mirrors the LangGraph frontend docs example.
 * Each node writes to its own typed state key so the UI can render
 * one card per node, and the final `synthesis` is available via `stream.values`.
 */
const State = Annotation.Root({
  ...MessagesAnnotation.spec,
  classification: Annotation<string>(),
  research: Annotation<string>(),
  analysis: Annotation<string>(),
  synthesis: Annotation<string>(),
});

/** Classify the user's query into a category. */
async function classifyNode(state: typeof State.State) {
  const lastHuman = [...state.messages].reverse().find((m) => m.getType() === "human");
  const prompt = lastHuman?.text ?? "";
  const res = await model.invoke([
    new SystemMessage(
      "You classify user queries into exactly one of: factual, conceptual, how-to, or open-ended. Reply with the single label only.",
    ),
    new HumanMessage(prompt),
  ]);
  return { classification: String(res.content).trim() };
}

/** Gather information relevant to the query. */
async function researchNode(state: typeof State.State) {
  const lastHuman = [...state.messages].reverse().find((m) => m.getType() === "human");
  const prompt = lastHuman?.text ?? "";
  const res = await model.invoke([
    new SystemMessage(
      "You are the research step of a pipeline. Given the user's query and its classification, produce a concise bullet list of key facts and context needed to answer. Use only your training knowledge.",
    ),
    new HumanMessage(
      `Query: ${prompt}\nClassification: ${state.classification ?? "unknown"}`,
    ),
  ]);
  return { research: String(res.content).trim() };
}

/** Draw conclusions from the research. */
async function analyzeNode(state: typeof State.State) {
  const lastHuman = [...state.messages].reverse().find((m) => m.getType() === "human");
  const prompt = lastHuman?.text ?? "";
  const res = await model.invoke([
    new SystemMessage(
      "You are the analysis step. Reason over the research findings and explain how they answer the query. Be concise and structured.",
    ),
    new HumanMessage(
      `Query: ${prompt}\nResearch:\n${state.research ?? ""}`,
    ),
  ]);
  return { analysis: String(res.content).trim() };
}

/** Produce a polished final response. */
async function synthesizeNode(state: typeof State.State) {
  const lastHuman = [...state.messages].reverse().find((m) => m.getType() === "human");
  const prompt = lastHuman?.text ?? "";
  const res = await model.invoke([
    new SystemMessage(
      "You are the synthesis step. Write the final, user-facing answer to the query, grounded in the analysis. Use clear markdown.",
    ),
    new HumanMessage(
      `Query: ${prompt}\nAnalysis:\n${state.analysis ?? ""}`,
    ),
  ]);
  const content = String(res.content).trim();
  return {
    synthesis: content,
    // Also append the final answer into the message transcript so
    // the frontend's node-scoped `useMessages` can stream it.
    messages: [{ role: "assistant", content }],
  };
}

export const graph = new StateGraph(State)
  .addNode("classify", classifyNode)
  .addNode("do_research", researchNode)
  .addNode("analyze", analyzeNode)
  .addNode("synthesize", synthesizeNode)
  .addEdge(START, "classify")
  .addEdge("classify", "do_research")
  .addEdge("do_research", "analyze")
  .addEdge("analyze", "synthesize")
  .addEdge("synthesize", END)
  .compile();

export type Pipeline = typeof graph;