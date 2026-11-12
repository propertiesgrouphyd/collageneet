import fs from "node:fs";

const file = "syllabus.json";

if (!fs.existsSync(file)) {
  throw new Error("syllabus.json not found");
}

const data = JSON.parse(
  fs.readFileSync(file, "utf8")
);

if (!data || typeof data !== "object") {
  throw new Error("Invalid syllabus root");
}

if (!Array.isArray(data.days)) {
  throw new Error("Invalid syllabus: days array missing");
}

if (data.days.length !== 365) {
  throw new Error(
    `Expected 365 days, found ${data.days.length}`
  );
}

/*
 * These are the fields that must exist.
 *
 * Some syllabus fields are intentionally optional.
 * For example Day 16 does not have "unit".
 *
 * We DO NOT modify the syllabus just to satisfy
 * the validator.
 */

/*
 * Actual 365-day syllabus schema.
 *
 * Present on all 365 days:
 *   day
 *   chapter
 *   topics
 *   neetFocus
 *
 * Present only on some days:
 *   subject
 *   unit
 *   subtopics
 *   learningOutcome
 *
 * Do not modify syllabus data merely to satisfy validation.
 */
const requiredKeys = [
  "day",
  "chapter",
  "topics",
  "neetFocus",
];

const optionalKeys = [
  "subject",
  "unit",
  "subtopics",
  "learningOutcome",
];

const seen = new Set();

for (let i = 0; i < data.days.length; i++) {

  const day = data.days[i];

  if (!day || typeof day !== "object") {
    throw new Error(
      `Day index ${i}: invalid object`
    );
  }

  const expectedDay = i + 1;

  if (Number(day.day) !== expectedDay) {
    throw new Error(
      `Sequence error: expected day ${expectedDay}, found ${day.day}`
    );
  }

  if (seen.has(Number(day.day))) {
    throw new Error(
      `Duplicate day: ${day.day}`
    );
  }

  seen.add(Number(day.day));

  for (const key of requiredKeys) {
    if (!(key in day)) {
      throw new Error(
        `Day ${day.day}: missing required field "${key}"`
      );
    }
  }

  if (!Array.isArray(day.topics)) {
    throw new Error(
      `Day ${day.day}: topics must be an array`
    );
  }

  if (
    day.subtopics !== undefined &&
    !Array.isArray(day.subtopics)
  ) {
    throw new Error(
      `Day ${day.day}: subtopics must be an array when present`
    );
  }

  if (!Array.isArray(day.neetFocus)) {
    throw new Error(
      `Day ${day.day}: neetFocus must be an array`
    );
  }

  /*
   * learningOutcome is optional in the existing 365-day syllabus.
   *
   * If the field exists, it must be either:
   *   - a string
   *   - an array
   *
   * Missing field is valid.
   */
  if (day.learningOutcome !== undefined) {
    if (
      typeof day.learningOutcome !== "string" &&
      !Array.isArray(day.learningOutcome)
    ) {
      throw new Error(
        `Day ${day.day}: learningOutcome must be a string or array`
      );
    }
  }
}

console.log("");
console.log("============================================================");
console.log(" VIDHWAAN NEET — SYLLABUS VALIDATION");
console.log("============================================================");
console.log("Root type :", typeof data);
console.log("Days      :", data.days.length);
console.log("First day :", data.days[0].day);
console.log("Last day  :", data.days.at(-1).day);
console.log("Sequence  : 1-365 COMPLETE");
console.log("Structure : VALID");
console.log("Optional  :", optionalKeys.join(", "));
console.log("Status    : PASS");
console.log("============================================================");
console.log("");
