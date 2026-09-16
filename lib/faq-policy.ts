type Faq = { question: string; answer: string };

function words(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Recognize service phrasing rather than requiring one exact verb.
const serviceIntent = /\b(?:help(?:s|ed|ing)?|assist(?:s|ed|ing|ance)?|support(?:s|ed|ing)?|handl(?:e|es|ed|ing)|provid(?:e|es|ed|ing)|offer(?:s|ed|ing)?|review(?:s|ed|ing)?|check(?:s|ed|ing)?|manag(?:e|es|ed|ing)|arrang(?:e|es|ed|ing)|prepar(?:e|es|ed|ing|ation)|translat(?:e|es|ed|ing|ion)|coordinat(?:e|es|ed|ing|ion)|services?|role)\b|\bwhat (?:can|does) ttaa do\b/;
const materials = /\b(?:documents?|scans?|copies|copy|files?|paperwork|certificates?|information|details)\b/;
const submission = /\b(?:send|sending|sent|submit|submitted|submitting|submission|upload|uploaded|uploading|share|sharing|provide|providing|email|emailing|attach|attaching)\b/;
const preparation = /\b(?:need|needed|needs|require|required|requirements|prepare|preparing|bring)\b/;
const reviewOrQuote = /\b(?:review|assessment|assess|quotation|quote|estimate|pricing|price|cost)\b/;

export function auditFaqIntents(faqs: Faq[], topic: string) {
  const issues: string[] = [];
  const firstQuestion = words(faqs[0]?.question || "");
  if (!/\bttaa\b/.test(firstQuestion) || !serviceIntent.test(firstQuestion)) {
    issues.push(`FAQ 1 question ${JSON.stringify(faqs[0]?.question || "(missing)")} must explicitly ask about TTAA's help or service for this topic. Use a topic-specific question such as ${JSON.stringify(`How can TTAA help with ${topic}?`)}; keep the answer factual and within TTAA's actual service scope.`);
  }

  const hasSubmissionFaq = faqs.some(({ question, answer }) => {
    const q = words(question);
    const a = words(answer);
    // The question must ask about submission, preparation, or a review/quote.
    // A passing answer must identify actual input materials, not just mention a price.
    const asksForInputs = (submission.test(q) && (materials.test(q) || /\b(?:what|which)\b/.test(q)))
      || (preparation.test(q) && (materials.test(q) || reviewOrQuote.test(q)));
    // A direct list answers "which documents should I submit?" without repeating
    // the verb. A general price/review question needs explicit input instructions.
    return materials.test(a) && (asksForInputs || (reviewOrQuote.test(q) && (submission.test(a) || preparation.test(a))));
  });
  if (!hasSubmissionFaq) {
    issues.push(`No FAQ explains which materials the reader should submit for review or a quotation. Replace one transaction FAQ with a topic-specific question such as ${JSON.stringify(`Which documents should I submit for a review of ${topic}?`)}. Its answer must identify the relevant documents, scans, files or details to send and their review purpose, using only supported facts. A question about price alone is insufficient. Current questions: ${JSON.stringify(faqs.map((faq) => faq.question))}.`);
  }
  return issues;
}
