import {
  safeJson,
  pickTextFromOpenAICompat,
  isOpenRouterGlm,
  isOpenRouterGoogleModel,
  isLikelyPublicHttpImageUrl,
  shouldFallbackOpenRouterCompatibility,
  shouldRetryOpenRouterImageCompatibility,
  isRetriableOpenRouterStatus,
  extractOpenRouterErrorMessage,
  sleepMs
} from "./shared.js";

const OPENROUTER_SMOKE_IMAGE_URL = "https://upload.wikimedia.org/wikipedia/commons/c/ce/Transparent.gif";

function buildSchema(mode) {
  if (mode === "alt") {
    return {
      name: "maca_alt_title",
      strict: true,
      schema: {
        type: "object",
        properties: { alt: { type: "string" }, title: { type: "string" }, decorativa: { type: "boolean" } },
        required: ["alt", "title"],
        additionalProperties: false
      }
    };
  }
  if (mode === "caption") {
    return {
      name: "maca_caption",
      strict: true,
      schema: {
        type: "object",
        properties: { leyenda: { type: "string" } },
        required: ["leyenda"],
        additionalProperties: false
      }
    };
  }
  return {
    name: "maca_alt_title_caption",
    strict: true,
    schema: {
      type: "object",
      properties: { alt: { type: "string" }, title: { type: "string" }, leyenda: { type: "string" }, decorativa: { type: "boolean" } },
      required: ["alt", "title", "leyenda"],
      additionalProperties: false
    }
  };
}

export function buildOpenRouterImageVariants({ model, dataUrl, sourceImageUrl }) {
  const variants = [];
  const seen = new Set();
  const add = (kind, imagePart) => {
    const key = `${kind}::${JSON.stringify(imagePart)}`;
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ kind, imagePart });
  };

  const publicUrl = isLikelyPublicHttpImageUrl(sourceImageUrl) ? String(sourceImageUrl) : "";
  const googleLike = isOpenRouterGoogleModel(model);

  if (googleLike && publicUrl) {
    add("remote_object", { type: "image_url", image_url: { url: publicUrl } });
    add("remote_string", { type: "image_url", image_url: publicUrl });
  }

  add("data_object", { type: "image_url", image_url: { url: dataUrl } });
  add("data_string", { type: "image_url", image_url: dataUrl });

  if (!googleLike && publicUrl) {
    add("remote_object", { type: "image_url", image_url: { url: publicUrl } });
    add("remote_string", { type: "image_url", image_url: publicUrl });
  }

  return variants;
}

export function buildOpenRouterAttemptPlan({ model, dataUrl, sourceImageUrl, mode }) {
  const useGlmModel = isOpenRouterGlm("openrouter", model);
  const googleLike = isOpenRouterGoogleModel(model);
  const imageVariants = buildOpenRouterImageVariants({ model, dataUrl, sourceImageUrl });
  const paramVariants = useGlmModel
    ? [
        { withDocsParams: true, withSchema: true },
        { withDocsParams: true, withSchema: false },
        { withDocsParams: false, withSchema: false },
        { withDocsParams: false, withSchema: false, forceAllowFallbacks: true }
      ]
    : [
        { withDocsParams: false, withSchema: true },
        { withDocsParams: false, withSchema: false }
      ];

  const plan = [];
  for (const params of paramVariants) {
    for (const image of imageVariants) {
      if (googleLike && params.withSchema && image.kind.startsWith("data_")) continue;
      plan.push({ ...params, imageKind: image.kind, imagePart: image.imagePart, mode });
    }
  }
  return plan;
}

export async function analyzeOpenRouter({ cfg, finalPrompt, dataUrl, sourceImageUrl, mode, fetchWithTimeout, abortSignal, addDebugLog }) {
  const model = String(cfg.model || "z-ai/glm-4.6v").trim();
  const useGlmModel = isOpenRouterGlm("openrouter", model);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "HTTP-Referer": "https://wordpress.org",
    "X-Title": "maca"
  };
  const makeBody = ({ withDocsParams = true, withSchema = true, forceAllowFallbacks = false, imagePart } = {}) => {
    const body = {
      model,
      messages: [{ role: "user", content: [{ type: "text", text: finalPrompt }, imagePart] }],
      max_tokens: 420,
      temperature: 0.2
    };
    if (useGlmModel && withDocsParams) {
      body.provider = { allow_fallbacks: false, require_parameters: true };
      body.reasoning = { exclude: true, effort: "none" };
    } else if (useGlmModel && forceAllowFallbacks) {
      body.provider = { allow_fallbacks: true };
    }
    if (withSchema) {
      body.response_format = { type: "json_schema", json_schema: buildSchema(mode) };
    }
    return body;
  };

  const attempts = buildOpenRouterAttemptPlan({ model, dataUrl, sourceImageUrl, mode });
  const startedAt = Date.now();
  let res = null;
  let json = null;
  let lastErrMsg = "";
  for (let i = 0; i < attempts.length; i++) {
    if ((Date.now() - startedAt) > 90000) throw new Error("Timeout global OpenRouter (90s).");
    const attempt = attempts[i];
    const request = { method: "POST", headers, body: JSON.stringify(makeBody(attempt)) };
    if (abortSignal) request.signal = abortSignal;
    res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", request, 30000);
    try {
      json = await safeJson(res, 25000);
    } catch (err) {
      lastErrMsg = err?.message || "Timeout leyendo respuesta de OpenRouter.";
      await addDebugLog(cfg, "openrouter_response_read_error", { attempt: i + 1, attemptConfig: { ...attempt, imagePart: undefined }, status: Number(res?.status || 0), error: lastErrMsg });
      if (i < attempts.length - 1) {
        await sleepMs(300 + (i * 250));
        continue;
      }
      throw new Error(lastErrMsg);
    }
    if (res.ok) break;
    lastErrMsg = extractOpenRouterErrorMessage(res.status, json);
    await addDebugLog(cfg, "openrouter_attempt_fail", { attempt: i + 1, attemptConfig: { ...attempt, imagePart: undefined }, status: Number(res?.status || 0), error: lastErrMsg });
    const canFallback = shouldFallbackOpenRouterCompatibility(res.status, json);
    const canRetryImage = shouldRetryOpenRouterImageCompatibility(res.status, json);
    const retriable = isRetriableOpenRouterStatus(res.status) || /provider returned error/i.test(lastErrMsg);
    if ((!canFallback && !canRetryImage && !retriable) || i >= attempts.length - 1) break;
    await sleepMs(250 + (i * 200));
  }
  if (!res.ok) throw new Error(lastErrMsg || extractOpenRouterErrorMessage(res?.status || 0, json));
  return { rawOutput: pickTextFromOpenAICompat(json) };
}

export async function testOpenRouterConfig({ cfg, model, fetchWithTimeout }) {
  const smokeModel = String(model || cfg.model || "").trim();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "HTTP-Referer": "https://wordpress.org",
    "X-Title": "maca"
  };
  const attempts = buildOpenRouterAttemptPlan({
    model: smokeModel,
    dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=",
    sourceImageUrl: OPENROUTER_SMOKE_IMAGE_URL,
    mode: "both"
  });

  let lastErr = "";
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const useGlmModel = isOpenRouterGlm("openrouter", smokeModel);
    const body = {
      model: smokeModel,
      messages: [{ role: "user", content: [{ type: "text", text: "Responde solo con: ok" }, attempt.imagePart] }],
      max_tokens: 4,
      temperature: 0
    };
    if (useGlmModel && attempt.withDocsParams) {
      body.provider = { allow_fallbacks: false, require_parameters: true };
      body.reasoning = { exclude: true, effort: "none" };
    } else if (useGlmModel && attempt.forceAllowFallbacks) {
      body.provider = { allow_fallbacks: true };
    }

    const res = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }, 12000);
    const json = await safeJson(res, 20000);
    if (res.ok) {
      return {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        attempt: i + 1,
        imageKind: attempt.imageKind
      };
    }
    lastErr = extractOpenRouterErrorMessage(res.status, json);
    const canFallback = shouldFallbackOpenRouterCompatibility(res.status, json);
    const canRetryImage = shouldRetryOpenRouterImageCompatibility(res.status, json);
    const retriable = isRetriableOpenRouterStatus(res.status) || /provider returned error/i.test(lastErr);
    if ((!canFallback && !canRetryImage && !retriable) || i >= attempts.length - 1) break;
    await sleepMs(200 + (i * 120));
  }

  throw new Error(lastErr || "Error OpenRouter al validar la configuración.");
}
