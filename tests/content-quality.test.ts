import assert from "node:assert/strict";
import test from "node:test";
import { auditFaqIntents } from "../lib/faq-policy";
import { classifyJobError } from "../lib/job-errors";
import { faqGate, generateAndEditArticle } from "../lib/openai";

const topic = "QVP Verification for KSA Work Visa";
const answer = "Send clear scans of the relevant qualification documents and the receiving institution's instructions for review. Include the requested language and intended use so the team can assess the translation scope. Requirements depend on the receiving institution, which makes the final acceptance decision.";
const serviceFaq = { question: "How can TTAA support my QVP application?", answer };
const inputFaq = { question: "Which files should I upload for an assessment?", answer };

test("equivalent service and document-submission wording passes", () => {
  for (const question of [
    "How can TTAA help with QVP?", "What support does TTAA offer for QVP?",
    "Can TTAA review my QVP documents?", "What is TTAA's role in QVP preparation?",
    "Does TTAA provide document translation?", "What assistance is available from TTAA?",
    "What can TTAA do for my application?", "Can TTAA arrange qualification translation?",
  ]) {
    for (const inputQuestion of [
      "What should I send for review?", "Which documents should I submit?",
      "Which files should I upload for an assessment?", "What paperwork is required for review?",
      "Which scans do you need for a quotation?", "How do I request an estimate?",
    ]) {
      assert.deepEqual(auditFaqIntents([{ question, answer }, { question: inputQuestion, answer }], topic), [], `${question} / ${inputQuestion}`);
    }
  }
});

test("a direct materials list answers a submission question without repeating its verb", () => {
  assert.deepEqual(auditFaqIntents([serviceFaq, {
    question: "Which documents should I submit for review?",
    answer: "Clear qualification scans, the receiving institution's instructions, the requested language and intended use.",
  }], topic), []);
});

test("missing service intent produces a specific, topic-aware repair instruction", () => {
  for (const question of ["What is QVP?", "Where is TTAA located?", "How can another agency help?"]) {
    const issues = auditFaqIntents([{ question, answer }, inputFaq], topic);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes(JSON.stringify(question)));
    assert.ok(issues[0].includes(`How can TTAA help with ${topic}?`));
  }
});

test("a quote keyword alone cannot replace an explanation of what to submit", () => {
  for (const faq of [
    { question: "How much does a quotation cost?", answer: "Prices vary by project." },
    { question: "Which scans should I send?", answer: "We are happy to assist." },
    { question: "Where is the office?", answer },
  ]) {
    const issues = auditFaqIntents([{ ...serviceFaq, answer: "We can review the translation scope." }, faq], topic);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /No FAQ explains which materials/);
    assert.ok(issues[0].includes(JSON.stringify(faq.question)));
  }
});

function faqPackage() {
  return {
    article: { faqs: [
      serviceFaq, inputFaq,
      { question: "Can TTAA review qualification terminology?", answer },
      { question: "How should QVP name differences be handled?", answer },
      { question: "Which qualification details require checking?", answer },
      { question: "How is the translation language determined?", answer },
      { question: "Who decides whether translated records are accepted?", answer },
    ].map((faq) => ({ ...faq })) },
    topicLock: { centralSubject: "QVP verification", languagePair: "", documentType: "qualification", formalProcess: "" },
  };
}

test("the full FAQ gate keeps count, brand, length, uniqueness and topic controls", () => {
  assert.deepEqual(faqGate(faqPackage(), { topic }), { passes: true, issues: [] });
  const cases: Array<[RegExp, (value: ReturnType<typeof faqPackage>) => void]> = [
    [/required range/, (value) => { value.article.faqs.pop(); }],
    [/unique/, (value) => { value.article.faqs[6] = value.article.faqs[5]; }],
    [/35-110 words/, (value) => { value.article.faqs.forEach((faq) => { faq.answer = "Send documents for review."; }); }],
    [/two FAQ questions must explicitly mention TTAA/, (value) => { value.article.faqs[2].question = "Can the team review qualification terminology?"; }],
    [/unique to the exact/, (value) => { value.topicLock.centralSubject = "unrelatedsubject"; value.topicLock.documentType = "unrelateddocument"; }],
    [/generic or prohibited/, (value) => { value.article.faqs[6].question = "Is translation always required?"; }],
    [/Formal-process questions/, (value) => { value.article.faqs[3].question = "Does QVP require an apostille?"; value.article.faqs[4].question = "Does qualification legalization apply?"; value.article.faqs[5].question = "Is notarization needed?"; }],
  ];
  for (const [expected, mutate] of cases) {
    const value = faqPackage();
    mutate(value);
    const result = faqGate(value, { topic });
    assert.equal(result.passes, false);
    assert.match(result.issues.join(" "), expected);
  }
});

test("quotation is a quality error while real quota and billing errors retain their classification", () => {
  const original = "The content quality repair could not resolve: The first FAQ must explain how TTAA helps with the exact service.; At least one FAQ must explain what to send for review or quotation.";
  for (const message of [original, "FAQ quality check: quotation instructions missing."]) {
    assert.equal(classifyJobError(new Error(message), "quality-control").code, "QUALITY_GATE_FAILED");
  }
  for (const message of ["You exceeded your current quota", "insufficient_quota", "billing_hard_limit_reached", "Billing account disabled", "Credit balance exhausted"]) {
    assert.equal(classifyJobError(new Error(message)).code, "BILLING_OR_QUOTA");
  }
  assert.equal(classifyJobError(new Error("Too many requests HTTP 429")).code, "RATE_LIMITED");
});

function modelArticle(valid: boolean) {
  const faqs = faqPackage().article.faqs;
  if (!valid) {
    faqs[0] = { question: "What is QVP?", answer };
    const noSubmission = "The scope varies according to the recipient and intended use. A translator considers language, terminology and layout before work begins. The receiving institution decides acceptance, and translation alone does not guarantee an outcome. Timelines depend on the agreed scope and availability.";
    faqs[1] = { question: "How much is a quotation?", answer: noSubmission };
    faqs.forEach((faq) => { faq.answer = noSubmission; });
  }
  return {
    eyebrow: "DOCUMENT SERVICES", title: topic,
    intro: "QVP Verification requires careful document checks for the intended recipient.",
    tldr: ["Review the receiving institution's instructions."],
    sections: Array.from({ length: 7 }, (_, i) => ({ title: `Preparation step ${i + 1}`, body: "Follow the receiving institution's current instructions.", items: [] })),
    faqs, cta: { title: "Document review", body: "Contact the team for a review.", buttonLabel: "Request review" },
    focusKeyword: "QVP Verification", secondaryKeywords: ["QVP document review", "qualification checks", "work visa documents"],
    seoTitle: "QVP Verification for KSA Work Visa Documents | TTAA",
    metaDescription: "QVP Verification for work visa documents: learn how to prepare qualification records for translation review and check the receiving institution's instructions.",
    slug: "qvp-verification", internalLinkSuggestions: [],
    imageSuggestions: ["featured", "inline"].map((placement) => ({ placement, altText: "Document review", imagePrompt: "Abstract document workflow" })),
    topicLock: { ...faqPackage().topicLock, primaryModifier: "", supportingSubjects: [], translationDirections: [], countryOrJurisdiction: "KSA", searchIntent: "document-use", mainAction: "Document review", primaryKeyword: "QVP Verification" },
    audit: { topicMatch: 95, primaryTopicCoverage: 80, topicDrift: 5, searchIntentMatch: 95, repetition: 5, legalClaimSafety: 98 },
  };
}

for (const repaired of [true, false]) {
  test(`offline writer/editor/repair flow ${repaired ? "accepts repaired FAQs" : "still blocks unresolved FAQs after two attempts"}`, async (t) => {
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "offline-test-key";
    t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
    const requests: Array<{ input: Array<{ content: string }> }> = [];
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses", "No real network calls are allowed");
      const payload = JSON.parse(String(init?.body));
      requests.push(payload);
      return Response.json({ id: `resp_test_${requests.length}`, status: "completed", output_text: JSON.stringify(modelArticle(repaired && requests.length >= 3)) });
    });
    const run = generateAndEditArticle({ topic, audience: "Applicants", country: "KSA", documentType: "qualification" }, []);
    if (repaired) {
      const result = await run;
      assert.equal(result.article.faqs[0].question, serviceFaq.question);
      assert.equal(requests.length, 3, "one successful repair should end the repair loop");
    } else {
      await assert.rejects(run, /The content quality repair could not resolve/);
      assert.equal(requests.length, 4, "repair remains bounded to two attempts");
    }
    assert.ok(requests[2].input[1].content.includes('FAQ 1 question "What is QVP?"'));
    assert.ok(requests[2].input[1].content.includes(`How can TTAA help with ${topic}?`));
    assert.ok(requests[2].input[1].content.includes("No FAQ explains which materials"));
  });
}
