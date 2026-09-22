import assert from "node:assert/strict";
import test from "node:test";
import { isAddressLine, localizeCountries } from "../lib/ceviri/address.ts";
import { translateSegment } from "../lib/ceviri/translate.ts";

test("recognises the address lines of the BASF letters", () => {
  for (const line of [
    "100 Park Avenue",
    "2 TW Alexander Drive",
    "2 TW ALEXANDER DRIVE",
    "Florham Park, New Jersey 07932",
    "Research Triangle Park, NC 27713",
    "RESEARCH TRIANGLE PARK, NC 27709-",
    "USA",
    "Carl-Bosch-Straße 38",
    "67056 Ludwigshafen",
    "67056 Ludwigshafen, Germany",
    "P.O. Box 13528",
    "Suite 400",
  ]) {
    assert.equal(isAddressLine(line), true, line);
  }
});

test("does not take ordinary text for an address", () => {
  for (const line of [
    "Notification of change to company name",
    "The two digit change in the zip code is the only change; neither the physical location nor any other part of the address is changing.",
    "BASF Agricultural Solutions US LLC",
    "Head of Crop Protection Regulatory Affairs, North America",
    "July 14, 2025",
    "Please find the required information to change for company number 7969:",
    "Current Name/Address",
    "500 g/l Dithianon",
    "Tel: (919) 547-2000",
  ]) {
    assert.equal(isAddressLine(line), false, line);
  }
});

test("translates only the country names in an address", () => {
  assert.equal(localizeCountries("USA", "tr-TR"), "ABD");
  assert.equal(localizeCountries("Research Triangle Park, NC 27713, USA", "tr-TR"), "Research Triangle Park, NC 27713, ABD");
  assert.equal(localizeCountries("67056 Ludwigshafen, Germany", "tr-TR"), "67056 Ludwigshafen, Almanya");
  assert.equal(localizeCountries("Basel, Switzerland", "de-DE"), "Basel, Schweiz");
  assert.equal(localizeCountries("100 Park Avenue", "tr-TR"), "100 Park Avenue");
  assert.equal(localizeCountries("United States", "tr-TR"), "Amerika Birleşik Devletleri");
});

test("leaves a street that merely contains a country-like word alone", () => {
  assert.equal(localizeCountries("12 Jordan Street", "tr-TR"), "12 Jordan Street");
});

test("an address line is never sent to the memory or the engines", async () => {
  const result = await translateSegment(
    { id: "a", text: "Research Triangle Park, NC 27713, USA" },
    { sourceLang: "en-US", targetLang: "tr-TR", model: "unused" },
  );
  assert.equal(result.translation, "Research Triangle Park, NC 27713, ABD");
  assert.equal(result.source, "rule");
  assert.match(result.note ?? "", /Adres/);
});
