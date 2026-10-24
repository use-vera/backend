const ApiError = require("../utils/api-error");
const env = require("../config/env");

/**
 * The one door to a language model. Callers speak a small provider-neutral
 * format; each provider maps it to its own API. Moving Vera from a local
 * model to the Claude API is a change of LLM_PROVIDER, not of callers.
 *
 * Message: { role: "user" | "assistant" | "tool", content, toolCalls?, toolName? }
 * Tool:    { name, description, parameters (JSON schema) }
 * Result:  { content, toolCalls: [{ id, name, arguments }] }
 */

const unavailable = () => new ApiError(503, "Vera can't think right now. Try again in a minute.", null, "VERA_UNAVAILABLE");

const parseArguments = (value) => {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/* ---------- Ollama (local, development) ---------- */

const toOllamaMessage = (message) => {
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_name: message.toolName };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || "",
      tool_calls: message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.arguments } })),
    };
  }
  return { role: message.role, content: message.content };
};

const ollamaChat = async ({ system, messages, tools }) => {
  let response;
  try {
    response = await fetch(`${env.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(env.llmTimeoutMs),
      body: JSON.stringify({
        model: env.llmModel,
        stream: false,
        options: { temperature: 0.4 },
        messages: [{ role: "system", content: system }, ...messages.map(toOllamaMessage)],
        tools: tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      }),
    });
  } catch (error) {
    console.error("[llm] ollama unreachable:", error?.name || "error");
    throw unavailable();
  }

  if (!response.ok) {
    console.error("[llm] ollama returned", response.status);
    throw unavailable();
  }

  const body = await response.json().catch(() => null);
  const message = body?.message;
  if (!message) throw unavailable();

  return {
    content: String(message.content || "").trim(),
    toolCalls: (message.tool_calls || [])
      .filter((call) => call?.function?.name)
      .map((call, index) => ({
        id: call.id || `call_${index}`,
        name: call.function.name,
        arguments: parseArguments(call.function.arguments),
      })),
  };
};

/* ---------- Dispatch ---------- */

const providers = {
  ollama: ollamaChat,
};

const chat = async ({ system, messages, tools = [] }) => {
  const provider = providers[env.llmProvider];
  if (!provider) {
    console.error(`[llm] provider "${env.llmProvider}" is not set up`);
    throw unavailable();
  }
  return provider({ system, messages, tools });
};

module.exports = { chat };
