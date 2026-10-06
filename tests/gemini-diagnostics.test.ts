import { afterEach, describe, expect, it, vi } from "vitest";
import { logGeminiFailure } from "../src/ai/diagnostics";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("development-only Gemini diagnostics", () => {
  it("reports the actual upstream project denial using allowlisted fields", () => {
    vi.stubEnv("NODE_ENV", "development"); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logGeminiFailure({ name: "ApiError", status: 403, message: JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "Your project has been denied access. Please contact support." } }) });
    expect(log).toHaveBeenCalledWith("[Yaqeen: Gemini request failed]", expect.objectContaining({ status: 403, name: "ApiError", code: "PERMISSION_DENIED", message: "Your project has been denied access. Please contact support." }));
  });
  it("omits credentials, arbitrary messages, causes, names, URLs and stacks", () => {
    vi.stubEnv("NODE_ENV", "development"); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "AIza-test-secret";
    logGeminiFailure({ status: 400, name: secret, message: JSON.stringify({ error: { status: secret, message: `key=${secret}; private input` } }), stack: secret, cause: { name: secret, code: secret, message: secret } });
    const output = JSON.stringify(log.mock.calls); expect(output).not.toContain(secret); expect(output).not.toContain("private input");
    expect(log).toHaveBeenCalledOnce();
  });
  it.each(["production", "test"])("does not log in %s", (mode) => {
    vi.stubEnv("NODE_ENV", mode); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logGeminiFailure(new Error("sensitive provider exception")); expect(log).not.toHaveBeenCalled();
  });
});
