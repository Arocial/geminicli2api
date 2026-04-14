export interface ModelVariant {
  baseModel: string;
  useSearch: boolean;
  thinkingBudget: number;
}

export function parseModelVariant(model: string): ModelVariant {
  let baseModel = model;
  let useSearch = false;
  let thinkingBudget = 8192;

  if (baseModel.endsWith('-search')) {
    baseModel = baseModel.slice(0, -'-search'.length);
    useSearch = true;
  }

  if (baseModel.endsWith('-nothinking')) {
    baseModel = baseModel.slice(0, -'-nothinking'.length);
    thinkingBudget = 0;
  } else if (baseModel.endsWith('-maxthinking')) {
    baseModel = baseModel.slice(0, -'-maxthinking'.length);
    thinkingBudget = 24576;
  }

  return { baseModel, useSearch, thinkingBudget };
}

/**
 * Convert raw Gemini REST API body into GenerateContentParameters format.
 *
 * Incoming REST body has top-level: contents, generationConfig, tools, systemInstruction, etc.
 * CodeAssistServer expects: { model, contents, config: { tools, thinkingConfig, ... } }
 */
export function toGenerateContentParams(
  model: string,
  body: Record<string, unknown>,
  opts: { useSearch: boolean; thinkingBudget: number },
) {
  const generationConfig = (body.generationConfig as Record<string, unknown>) ?? {};
  const tools = (body.tools as unknown[]) ?? [];

  // Thinking config
  const thinkingConfig =
    opts.thinkingBudget > 0
      ? { includeThoughts: true, thinkingBudget: opts.thinkingBudget }
      : { thinkingBudget: 0 };

  // Google Search grounding
  if (opts.useSearch) {
    tools.push({ googleSearch: {} });
  }

  return {
    model,
    contents: body.contents,
    config: {
      ...generationConfig,
      tools: tools.length > 0 ? tools : undefined,
      toolConfig: body.toolConfig,
      systemInstruction: body.systemInstruction,
      thinkingConfig,
    },
  };
}
