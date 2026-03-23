import test from "node:test";
import assert from "node:assert/strict";

import { buildOpenRouterAttemptPlan, analyzeOpenRouter, testOpenRouterConfig } from "../src/shared/providers/openrouter.js";

test("OpenRouter Google models prefer remote image URLs before data URLs", () => {
  const plan = buildOpenRouterAttemptPlan({
    model: "google/gemini-2.5-flash",
    dataUrl: "data:image/png;base64,AAAA",
    sourceImageUrl: "https://example.com/image.png",
    mode: "both"
  });

  assert.equal(plan[0].imageKind, "remote_object");
  assert.equal(plan[1].imageKind, "remote_string");
  assert.ok(plan.some((attempt) => attempt.imageKind === "data_object"));
  assert.ok(plan.some((attempt) => attempt.withSchema === false));
});

test("OpenRouter GLM models keep dedicated compatibility attempts", () => {
  const plan = buildOpenRouterAttemptPlan({
    model: "z-ai/glm-4.6v",
    dataUrl: "data:image/png;base64,AAAA",
    sourceImageUrl: "https://example.com/image.png",
    mode: "both"
  });

  assert.ok(plan.some((attempt) => attempt.withDocsParams === true && attempt.withSchema === true));
  assert.ok(plan.some((attempt) => attempt.forceAllowFallbacks === true));
});

test("OpenRouter retries image compatibility variants after provider image errors", async () => {
  const bodies = [];
  let calls = 0;
  const fetchWithTimeout = async (_url, request) => {
    calls += 1;
    const body = JSON.parse(String(request.body || "{}"));
    bodies.push(body);
    if (calls < 3) {
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            error: {
              message: "Provider returned error",
              code: 400,
              metadata: {
                provider_name: "Google AI Studio",
                raw: '{"error":{"message":"Unable to process input image"}}'
              }
            }
          });
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [{ message: { content: '{"alt":"ok","title":"ok","leyenda":"ok"}' } }]
        });
      }
    };
  };

  const out = await analyzeOpenRouter({
    cfg: { apiKey: "test", model: "google/gemini-2.5-flash" },
    finalPrompt: "test",
    dataUrl: "data:image/png;base64,AAAA",
    sourceImageUrl: "https://example.com/image.png",
    mode: "both",
    fetchWithTimeout,
    abortSignal: null,
    addDebugLog: async () => {}
  });

  assert.equal(typeof out.rawOutput, "string");
  assert.equal(calls, 3);
  assert.equal(bodies[0].messages[0].content[1].image_url.url, "https://example.com/image.png");
  assert.equal(bodies[1].messages[0].content[1].image_url, "https://example.com/image.png");
});

test("OpenRouter config test retries Google image variants", async () => {
  const bodies = [];
  let calls = 0;
  const fetchWithTimeout = async (_url, request) => {
    calls += 1;
    bodies.push(JSON.parse(String(request.body || "{}")));
    if (calls < 3) {
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            error: {
              message: "Provider returned error",
              code: 400,
              metadata: {
                provider_name: "Google AI Studio",
                raw: '{"error":{"message":"Unable to process input image"}}'
              }
            }
          });
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: "ok" } }] });
      }
    };
  };

  const out = await testOpenRouterConfig({
    cfg: { apiKey: "test", model: "google/gemini-2.5-flash" },
    model: "google/gemini-2.5-flash",
    fetchWithTimeout
  });

  assert.equal(out.attempt, 3);
  assert.equal(out.imageKind, "remote_object");
  assert.equal(bodies[0].messages[0].content[1].image_url.url.includes("wikimedia.org"), true);
  assert.equal(bodies[1].messages[0].content[1].image_url.includes("wikimedia.org"), true);
  assert.equal(!!bodies[0].response_format, false);
  assert.equal(!!bodies[2].response_format, false);
});
