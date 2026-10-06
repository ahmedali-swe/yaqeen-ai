import intentions from "./hadeethenc-intentions.json";
import understanding from "./hadeethenc-understanding.json";
import purity from "./hadeethenc-purity.json";

export const officialDetails = [intentions, understanding, purity];
/** Test-only positive fixture transport. Real captured Arabic detail records,
 * no live network. Full captured search responses test ambiguity separately. */
export const fixtureSourceFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.origin !== "https://hadeethenc.com") throw new Error("Unexpected source");
  if (url.pathname.endsWith("/search/")) return Response.json(officialDetails.map(({ id, title, hadeeth }) => ({ id, title, hadith_text: hadeeth })));
  const record = officialDetails.find((item) => item.id === url.searchParams.get("id"));
  return record ? Response.json(record) : new Response(null, { status: 503 });
};
