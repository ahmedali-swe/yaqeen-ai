import { claim } from "./claims";

export const bukhari71Content = "قال الكاتب: «من يرد الله به خيرًا يفقهه في الدين»، ثم استنتج أن كل من لم يتخصص في الفقه أو لم يكن لديه علم شرعي واسع فهذا دليل على أن الله لا يريد به خيرًا.";
const quoteText = "«من يرد الله به خيرًا يفقهه في الدين»";
const conclusionText = "كل من لم يتخصص في الفقه أو لم يكن لديه علم شرعي واسع فهذا دليل على أن الله لا يريد به خيرًا";
export const bukhari71Quote = claim(quoteText, {
  id: "bukhari-quote", claimType: "QUOTE", originalStart: bukhari71Content.indexOf(quoteText), originalEnd: bukhari71Content.indexOf(quoteText) + quoteText.length,
});
export const bukhari71Conclusion = claim(conclusionText, {
  id: "bukhari-conclusion", claimType: "INTERPRETATION", originalStart: bukhari71Content.indexOf(conclusionText), originalEnd: bukhari71Content.indexOf(conclusionText) + conclusionText.length,
});
