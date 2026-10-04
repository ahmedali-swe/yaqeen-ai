export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { parseEnv } = await import("./lib/env");
    parseEnv(process.env);
  }
}
