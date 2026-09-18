import { randomInt } from "node:crypto";

export type VerificationBrand = "ay-tercume" | "ttaa";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const randomLength = 16;

function randomCharacters() {
  let value = "";
  for (let index = 0; index < randomLength; index += 1) value += alphabet[randomInt(alphabet.length)];
  return value;
}

export function generateVerificationDocumentNumber(brand: VerificationBrand) {
  let randomPart = "";
  do randomPart = randomCharacters();
  while (!/[A-Z]/.test(randomPart) || !/[a-z]/.test(randomPart) || !/[2-9]/.test(randomPart));

  const grouped = randomPart.match(/.{1,4}/g)?.join("-") || randomPart;
  return `${brand === "ay-tercume" ? "AY" : "TTAA"}-${grouped}`;
}
