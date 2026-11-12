import fs from "node:fs";
import path from "node:path";

import {
  buildLessonPrompt,
  buildMcqPrompt
} from "./prompt.js";

import {
  generateLesson,
  generateTopicMcqs
} from "./groq.js";

import {
  validateDayContent,
  validateMcqs
} from "./validate-day.js";

const ROOT = process.cwd();

const SYLLABUS_FILE =
  path.join(ROOT, "syllabus.json");

const CONFIG_FILE =
  path.join(ROOT, "config", "app-config.json");

const DATA_DIR =
  path.join(ROOT, "public", "data");


function fail(message) {
  console.error("");
  console.error("==============================================");
  console.error(" VIDHWAAN NEET — GENERATION FAILED");
  console.error("==============================================");
  console.error(message);
  console.error("==============================================");
  process.exit(1);
}


function readJson(file) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch (error) {
    fail(
      `Invalid JSON:\n${file}\n${error.message}`
    );
  }
}


function getDays(root) {
  if (Array.isArray(root)) {
    return root;
  }

  if (Array.isArray(root?.days)) {
    return root.days;
  }

  fail(
    "syllabus.json does not contain a valid days array."
  );
}


/*
 * ------------------------------------------------------
 * AUTHORITATIVE TOPIC EXTRACTION
 * ------------------------------------------------------
 *
 * IMPORTANT:
 *
 * Only day.topics are lesson section topics.
 *
 * day.chapter     = context/title
 * day.topics      = authoritative section topics
 * day.subtopics   = supporting requirements
 * day.neetFocus   = exam priorities
 *
 * NEVER add chapter or subtopics to this list.
 */
function getTopics(day) {
  if (!Array.isArray(day?.topics)) {
    fail(
      `Day ${day?.day ?? "unknown"} does not contain a valid topics array.`
    );
  }

  const topics = [];

  for (const item of day.topics) {
    let topic = null;

    if (typeof item === "string") {
      topic = item.trim();
    }

    else if (
      item &&
      typeof item === "object"
    ) {
      topic = String(
        item.topic ??
        item.title ??
        item.name ??
        ""
      ).trim();
    }

    if (!topic) {
      fail(
        `Day ${day.day} contains an invalid or empty topic in the topics array.`
      );
    }

    if (topics.includes(topic)) {
      fail(
        `Day ${day.day} contains a duplicate syllabus topic: "${topic}"`
      );
    }

    topics.push(topic);
  }

  if (topics.length === 0) {
    fail(
      `Day ${day.day} contains no syllabus topics.`
    );
  }

  return topics;
}


/*
 * ------------------------------------------------------
 * NORMALIZE AI-GENERATED LESSON
 * ------------------------------------------------------
 *
 * Groq may occasionally return a valid JSON object
 * with learningOutcome in the wrong shape.
 *
 * The validator remains strict.
 *
 * This function converts safe equivalent shapes into
 * the required canonical format before validation.
 */
function normalizeGeneratedLesson(
  lesson,
  syllabusDay
) {
  if (
    !lesson ||
    typeof lesson !== "object" ||
    Array.isArray(lesson)
  ) {
    throw new Error(
      "Groq returned an invalid lesson object."
    );
  }


  /*
   * learningOutcome
   *
   * Required final format:
   *
   * [
   *   "string",
   *   "string"
   * ]
   */

  if (
    typeof lesson.learningOutcome === "string"
  ) {
    const value =
      lesson.learningOutcome.trim();

    lesson.learningOutcome =
      value ? [value] : [];
  }

  else if (
    lesson.learningOutcome &&
    typeof lesson.learningOutcome === "object" &&
    !Array.isArray(lesson.learningOutcome)
  ) {
    const candidate =
      lesson.learningOutcome.items ||
      lesson.learningOutcome.outcomes ||
      lesson.learningOutcome.points ||
      lesson.learningOutcome.text ||
      lesson.learningOutcome.content;

    if (Array.isArray(candidate)) {
      lesson.learningOutcome =
        candidate
          .map(item => String(item).trim())
          .filter(Boolean);
    }

    else if (candidate) {
      lesson.learningOutcome = [
        String(candidate).trim()
      ];
    }

    else {
      lesson.learningOutcome = [];
    }
  }


  /*
   * If Groq returned null, undefined, or another
   * unexpected type, convert it to an empty array.
   */
  if (
    !Array.isArray(
      lesson.learningOutcome
    )
  ) {
    lesson.learningOutcome = [];
  }


  /*
   * Last-resort safe fallback.
   *
   * This prevents an otherwise valid lesson from
   * failing only because Groq omitted learningOutcome.
   */
  if (
    lesson.learningOutcome.length === 0
  ) {
    const chapter =
      String(
        syllabusDay?.chapter ||
        syllabusDay?.title ||
        "today's NEET topic"
      ).trim();

    lesson.learningOutcome = [
      `Understand the important NEET concepts, facts, and applications covered in ${chapter}.`
    ];
  }


  /*
   * Ensure every outcome is a clean string.
   */
  lesson.learningOutcome =
    lesson.learningOutcome
      .map(item => String(item).trim())
      .filter(Boolean);


  /*
   * ----------------------------------------------------
   * NORMALIZE MCQ ANSWER INDEX
   * ----------------------------------------------------
   *
   * Canonical format:
   *
   * 0 = option A
   * 1 = option B
   * 2 = option C
   * 3 = option D
   *
   * This is mainly a safety layer if a lesson response
   * happens to contain MCQs despite the prompt.
   */

  if (Array.isArray(lesson.mcqs)) {
    lesson.mcqs =
      lesson.mcqs.map(mcq => {
        if (
          !mcq ||
          typeof mcq !== "object"
        ) {
          return mcq;
        }

        if (
          !Number.isInteger(mcq.answer)
        ) {
          const raw =
            mcq.correctAnswer ??
            mcq.correct_answer ??
            mcq.correctOption ??
            mcq.correct_option;

          if (typeof raw === "string") {
            const value =
              raw.trim().toUpperCase();

            if (/^[ABCD]$/.test(value)) {
              mcq.answer =
                value.charCodeAt(0) - 65;
            }

            else if (/^\d+$/.test(value)) {
              const number =
                Number(value);

              if (
                number >= 0 &&
                number <= 3
              ) {
                mcq.answer = number;
              }

              else if (
                number >= 1 &&
                number <= 4
              ) {
                mcq.answer =
                  number - 1;
              }
            }
          }
        }

        return mcq;
      });
  }


  return lesson;
}


function findLastGeneratedDay() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });

    return 0;
  }

  let highest = 0;

  for (
    const file of fs.readdirSync(DATA_DIR)
  ) {
    const match =
      file.match(/^day-(\d{3})\.json$/);

    if (!match) continue;

    highest =
      Math.max(
        highest,
        Number(match[1])
      );
  }

  return highest;
}


function calculateCourseDate(
  startDate,
  dayNumber
) {
  const [year, month, day] =
    String(startDate)
      .split("-")
      .map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    fail(
      `Invalid courseStartDate: ${startDate}`
    );
  }

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  date.setUTCDate(
    date.getUTCDate() +
    dayNumber -
    1
  );

  return date
    .toISOString()
    .slice(0, 10);
}


function createPublishAt(
  courseDate,
  publishTime
) {
  return (
    `${courseDate}T${publishTime}:00+05:30`
  );
}


/*
 * ------------------------------------------------------
 * NORMALIZE TOPIC
 * ------------------------------------------------------
 */
function normalizeTopic(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}


/*
 * ------------------------------------------------------
 * REMOVE DUPLICATE MCQs
 * ------------------------------------------------------
 *
 * IMPORTANT:
 *
 * Duplicate questions are checked within the SAME
 * topic only.
 *
 * The same question text appearing under different
 * topics must not cause one topic's MCQ to disappear.
 */
function uniqueMcqs(mcqs) {
  const seen = new Set();
  const result = [];

  for (const mcq of mcqs) {
    const key =
      `${normalizeTopic(mcq.topic)}::${mcq.question
        .trim()
        .toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(mcq);
  }

  return result;
}


/*
 * ------------------------------------------------------
 * EXACT TOPIC MATCH
 * ------------------------------------------------------
 *
 * Do not use includes() or fuzzy matching.
 *
 * Every generated section must correspond exactly
 * to one authoritative syllabus topic.
 */
function topicMatches(
  generatedTopic,
  expectedTopic
) {
  return (
    normalizeTopic(generatedTopic) ===
    normalizeTopic(expectedTopic)
  );
}


/*
 * ------------------------------------------------------
 * COMPLETE LESSON VALIDATION
 * ------------------------------------------------------
 *
 * This additional check guarantees that every expected
 * topic exists exactly once and in the correct order.
 */
function validateCompleteLesson(
  lesson,
  topics
) {
  validateDayContent(
    lesson,
    undefined,
    topics
  );

  if (
    !Array.isArray(lesson.sections)
  ) {
    throw new Error(
      "Lesson sections must be an array."
    );
  }

  if (
    lesson.sections.length !== topics.length
  ) {
    throw new Error(
      `Lesson section count ${lesson.sections.length} does not equal syllabus topic count ${topics.length}.`
    );
  }

  for (
    let i = 0;
    i < topics.length;
    i++
  ) {
    const generatedTopic =
      lesson.sections[i]?.topic;

    const expectedTopic =
      topics[i];

    if (
      !topicMatches(
        generatedTopic,
        expectedTopic
      )
    ) {
      throw new Error(
        `Section ${i + 1} topic mismatch. Expected "${expectedTopic}" but received "${generatedTopic}".`
      );
    }
  }
}


/*
 * ------------------------------------------------------
 * GENERATE COMPLETE LESSON
 * ------------------------------------------------------
 *
 * Keep generating the SAME lesson until it passes
 * strict validation.
 *
 * Groq rate-limit waiting/retry is handled inside
 * groq.js.
 */
async function generateCompleteLesson(
  day,
  topics
) {
  let attempt = 0;

  while (true) {
    attempt++;

    console.log("");
    console.log(
      `Lesson validation attempt: ${attempt}`
    );

    try {
      let lesson =
        await generateLesson(
          buildLessonPrompt(day)
        );

      lesson =
        normalizeGeneratedLesson(
          lesson,
          day
        );

      validateCompleteLesson(
        lesson,
        topics
      );

      console.log(
        "Lesson validation: PASSED"
      );

      return lesson;

    } catch (error) {
      console.warn("");
      console.warn(
        "Lesson validation failed."
      );
      console.warn(
        error.message
      );
      console.warn(
        "Regenerating the SAME lesson..."
      );
      console.warn("");
    }
  }
}


/*
 * ------------------------------------------------------
 * GENERATE COMPLETE TOPIC MCQs
 * ------------------------------------------------------
 *
 * One request is made for one authoritative topic.
 *
 * Required:
 *   minimum = 5
 *   maximum = 10
 *
 * If generation or validation fails, the SAME topic
 * is retried until it succeeds.
 */
async function generateCompleteTopicMcqs(
  day,
  topic
) {
  let attempt = 0;

  while (true) {
    attempt++;

    console.log(
      `  MCQ generation attempt ${attempt}: ${topic}`
    );

    try {
      const result =
        await generateTopicMcqs(
          buildMcqPrompt(
            day,
            topic
          )
        );


      if (
        !Array.isArray(
          result?.mcqs
        )
      ) {
        throw new Error(
          "Groq did not return an mcqs array."
        );
      }


      validateMcqs(
        result.mcqs,
        5,
        10
      );


      const mcqs =
        result.mcqs.map(mcq => ({
          ...mcq,
          topic
        }));


      console.log(
        `  ✓ ${mcqs.length} valid MCQs collected`
      );


      return mcqs;

    } catch (error) {
      console.warn(
        `  Topic failed: ${error.message}`
      );

      console.warn(
        `  Retrying SAME topic: ${topic}`
      );
    }
  }
}


/*
 * ------------------------------------------------------
 * VALIDATE MCQ COUNT PER TOPIC
 * ------------------------------------------------------
 *
 * Every authoritative syllabus topic must have
 * between 5 and 10 MCQs.
 */
function validateMcqCountPerTopic(
  mcqs,
  topics
) {
  for (const topic of topics) {
    const topicMcqCount =
      mcqs.filter(
        mcq =>
          topicMatches(
            mcq.topic,
            topic
          )
      ).length;

    if (
      topicMcqCount < 5 ||
      topicMcqCount > 10
    ) {
      throw new Error(
        `MCQ count failure for topic "${topic}": expected 5-10, received ${topicMcqCount}.`
      );
    }
  }
}


/*
 * ------------------------------------------------------
 * MAIN
 * ------------------------------------------------------
 */
async function main() {
  const syllabus =
    readJson(SYLLABUS_FILE);

  const config =
    readJson(CONFIG_FILE);

  const days =
    getDays(syllabus);

  const totalDays =
    Number(config.totalDays);

  if (
    days.length !== totalDays
  ) {
    fail(
      `Syllabus contains ${days.length} days but config requires ${totalDays}.`
    );
  }


  const lastDay =
    findLastGeneratedDay();

  const nextDay =
    lastDay + 1;


  console.log("");
  console.log("==============================================");
  console.log(" VIDHWAAN NEET — DAILY AI GENERATOR");
  console.log("==============================================");

  console.log(
    `Last generated : ${lastDay}`
  );

  console.log(
    `Next day       : ${nextDay}`
  );

  console.log(
    `Total days     : ${totalDays}`
  );

  console.log(
    `Model          : ${
      process.env.GROQ_MODEL ||
      "openai/gpt-oss-120b"
    }`
  );

  console.log(
    "Strategy       : complete lesson + 5-10 MCQs per topic"
  );

  console.log("==============================================");


  if (nextDay > totalDays) {
    console.log(
      "All 365 lessons are already generated."
    );
    return;
  }


  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });


  const outputFile =
    path.join(
      DATA_DIR,
      `day-${String(nextDay).padStart(3, "0")}.json`
    );


  if (fs.existsSync(outputFile)) {
    fail(
      `Safety stop: ${outputFile} already exists.`
    );
  }


  const day =
    days.find(
      item =>
        Number(item.day) === nextDay
    );


  if (!day) {
    fail(
      `Day ${nextDay} was not found in syllabus.json.`
    );
  }


  const courseDate =
    calculateCourseDate(
      config.courseStartDate,
      nextDay
    );


  const publishAt =
    createPublishAt(
      courseDate,
      config.publishTime
    );


  /*
   * IMPORTANT:
   *
   * ONLY day.topics are used.
   *
   * chapter/subtopics/neetFocus are NOT added as
   * separate lesson or MCQ topics.
   */
  const topics =
    getTopics(day);


  console.log("");
  console.log(
    `Syllabus day : ${nextDay}`
  );

  console.log(
    `Course date  : ${courseDate}`
  );

  console.log(
    `Publish at   : ${publishAt}`
  );

  console.log(
    `Topics found : ${topics.length}`
  );

  console.log("");


  for (
    let i = 0;
    i < topics.length;
    i++
  ) {
    console.log(
      `Topic ${i + 1}: ${topics[i]}`
    );
  }


  /*
   * ------------------------------------------------------
   * STEP 1
   * COMPLETE LESSON
   * ------------------------------------------------------
   */

  console.log("");
  console.log(
    "STEP 1 — Generating complete lesson..."
  );


  const lesson =
    await generateCompleteLesson(
      day,
      topics
    );


  console.log(
    `Lesson sections: ${lesson.sections.length}`
  );


  /*
   * ------------------------------------------------------
   * STEP 2
   * TOPIC-WISE MCQs
   * ------------------------------------------------------
   *
   * The next topic is NEVER started until the current
   * topic has successfully produced 5-10 valid MCQs.
   */

  console.log("");
  console.log(
    "STEP 2 — Generating topic-wise NEET MCQs..."
  );


  const allMcqs = [];


  for (
    let i = 0;
    i < topics.length;
    i++
  ) {
    const topic =
      topics[i];

    console.log("");
    console.log(
      `MCQ ${i + 1}/${topics.length}: ${topic}`
    );


    const topicMcqs =
      await generateCompleteTopicMcqs(
        day,
        topic
      );


    allMcqs.push(
      ...topicMcqs
    );
  }


  /*
   * Remove exact duplicate questions within the
   * SAME topic only.
   */
  const mcqs =
    uniqueMcqs(allMcqs);


  console.log("");
  console.log(
    `Valid MCQs collected: ${mcqs.length}`
  );


  /*
   * ------------------------------------------------------
   * FINAL PER-TOPIC MCQ COUNT
   * ------------------------------------------------------
   */
  try {
    validateMcqCountPerTopic(
      mcqs,
      topics
    );
  } catch (error) {
    fail(
      `Final MCQ validation failed:\n${error.message}`
    );
  }


  /*
   * ------------------------------------------------------
   * FINAL OBJECT
   * ------------------------------------------------------
   */

  const generated = {
    day: nextDay,

    courseDate,

    publishAt,

    title:
      lesson.title,

    introduction:
      lesson.introduction,

    sections:
      lesson.sections,

    learningOutcome:
      lesson.learningOutcome,

    mcqs,

    generation: {
      model:
        process.env.GROQ_MODEL ||
        "openai/gpt-oss-120b",

      strategy:
        "5-10 MCQs per exact syllabus topic",

      topicCount:
        topics.length,

      mcqCount:
        mcqs.length
    }
  };


  /*
   * ------------------------------------------------------
   * FINAL SAFETY VALIDATION
   * ------------------------------------------------------
   */

  try {
    validateCompleteLesson(
      generated,
      topics
    );


    validateMcqs(
      generated.mcqs
    );


    validateMcqCountPerTopic(
      generated.mcqs,
      topics
    );


  } catch (error) {
    fail(
      `Final validation failed:\n${error.message}`
    );
  }


  /*
   * ------------------------------------------------------
   * WRITE ONLY AFTER ALL VALIDATION PASSES
   * ------------------------------------------------------
   */

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      generated,
      null,
      2
    ) + "\n",
    "utf8"
  );


  /*
   * ------------------------------------------------------
   * READ THE ACTUAL WRITTEN FILE AGAIN
   * ------------------------------------------------------
   *
   * This validates the exact JSON file that the
   * frontend will eventually read.
   */

  try {
    const saved =
      JSON.parse(
        fs.readFileSync(
          outputFile,
          "utf8"
        )
      );


    validateCompleteLesson(
      saved,
      topics
    );


    validateMcqs(
      saved.mcqs
    );


    validateMcqCountPerTopic(
      saved.mcqs,
      topics
    );


  } catch (error) {
    fs.rmSync(
      outputFile,
      {
        force: true
      }
    );

    fail(
      `Written file validation failed:\n${error.message}`
    );
  }


  /*
   * ------------------------------------------------------
   * SUCCESS
   * ------------------------------------------------------
   */

  console.log("");
  console.log("==============================================");
  console.log(" DAILY NEET LESSON GENERATED");
  console.log("==============================================");

  console.log(
    `Day       : ${nextDay}`
  );

  console.log(
    `Date      : ${courseDate}`
  );

  console.log(
    `Sections  : ${generated.sections.length}`
  );

  console.log(
    `Topics    : ${topics.length}`
  );

  console.log(
    `MCQs      : ${generated.mcqs.length}`
  );

  console.log(
    `Output    : ${path.relative(ROOT, outputFile)}`
  );

  console.log(
    "Validation: PASSED"
  );

  console.log("==============================================");
}


main().catch(error => {
  fail(
    error?.stack ||
    error?.message ||
    String(error)
  );
});
