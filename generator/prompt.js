export function buildLessonPrompt(day) {
  return `
You are a senior NEET-UG preparation content author.

Create ONE high-quality study lesson ONLY for the supplied syllabus day.

NEET STANDARD:
- Follow the supplied syllabus exactly.
- Cover EVERY topic and subtopic supplied.
- Do not teach topics from other days.
- Use scientifically accurate NCERT-aligned terminology.
- Explain from fundamentals to NEET-exam level.
- Prioritize concepts, mechanisms, formulas, definitions, relationships,
  exceptions, diagrams-in-words where useful, and high-yield facts.
- Do not invent facts.
- Do not add unrelated information.
- Avoid unnecessary verbosity.
- Use short, information-dense paragraphs.

LESSON:
For every supplied topic create a corresponding section.

Each section MUST contain:
- topic
- heading
- content
- keyPoints
- neetTips

The fields keyPoints and neetTips MUST always be JSON arrays
of strings.

LEARNING OUTCOME — VERY IMPORTANT:
- learningOutcome MUST ALWAYS be a JSON array.
- Every item inside learningOutcome MUST be a string.
- Example:
  "learningOutcome": [
    "Understand the major concepts covered in this lesson.",
    "Apply the concepts to NEET-level questions."
  ]
- NEVER return learningOutcome as a string.
- NEVER return learningOutcome as an object.
- NEVER return learningOutcome as null.
- NEVER omit learningOutcome.

MCQs:
- Do NOT generate MCQs in this call.
- MCQs are generated separately.

LANGUAGE:
- English only.

OUTPUT:
- Return ONLY valid JSON.
- No markdown.
- No code fences.
- No explanatory text before or after the JSON.
- Follow the JSON structure exactly.

EXACT JSON STRUCTURE:
{
  "title": "string",
  "introduction": "string",
  "sections": [
    {
      "topic": "string",
      "heading": "string",
      "content": "string",
      "keyPoints": ["string"],
      "neetTips": ["string"]
    }
  ],
  "learningOutcome": ["string"]
}

FINAL CHECK:
1. Valid JSON.
2. sections contains exactly one section for each item in topics.
3. Section order exactly matches topics order.
4. Every section.topic exactly matches its supplied topic.
5. Every supplied subtopic is covered.
6. keyPoints and neetTips are arrays of strings.
7. learningOutcome is a non-empty array of strings.
8. No MCQs are included.
9. All content follows the supplied syllabus only.

SYLLABUS:
${JSON.stringify(day)}
`;
}


export function buildMcqPrompt(day, topic) {
  return `
You are an expert NEET-UG examination question setter.

AUTHORITATIVE TOPIC:
The exact topic for this request is:
"${String(topic).trim()}"

Create ORIGINAL NEET-level MCQs ONLY from this exact topic
and its supplied syllabus context.

ADAPTIVE MCQ COUNT:
First assess the conceptual breadth of the authoritative topic
using the supplied day, chapter, subtopics and NEET-focused context.

Choose the number of MCQs intelligently:
- 5 MCQs for a narrow topic.
- 6 to 7 MCQs for a moderately broad topic.
- 8 to 9 MCQs for a broad topic.
- 10 MCQs for a very broad topic.

STRICT COUNT:
- Minimum: 5 MCQs.
- Maximum: 10 MCQs.
- Never generate fewer than 5.
- Never generate more than 10.
- Do not add repetitive questions just to reach a higher count.
- Generate more questions only when the topic contains enough
  distinct NEET-relevant concepts worth testing.

IMPORTANT TOPIC BOUNDARY:
- The authoritative topic is the exact topic string above.
- Do not generate questions for another topic.
- Do not silently replace, broaden, merge or rename the topic.
- Use the supplied day only as context for understanding this topic.
- Use relevant supplied subtopics when they belong to this topic.
- For an integrated revision topic, questions may test the supplied
  integrated revision material, comparisons, examples and subtopics,
  but must remain within this topic's scope.

QUESTION QUALITY:
- Match the conceptual difficulty of the NEET-UG public examination.
- Test understanding, application, interpretation, calculation,
  mechanism, comparison or precise factual knowledge where appropriate.
- Cover different meaningful concepts within the topic.
- Avoid trivial questions.
- Avoid Olympiad/JEE-Advanced level questions.
- Avoid ambiguous wording.
- Exactly ONE option must be correct.
- All four options must be plausible.
- Do not reveal the answer in the wording.
- Do not repeat the same concept unnecessarily.
- Use NCERT-aligned terminology.
- Check every answer carefully before returning it.

OUTPUT:
- Return ONLY valid JSON.
- No markdown.
- No code fences.
- No explanatory text before or after the JSON.

EXACT JSON STRUCTURE:
{
  "mcqs": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "answer": 0,
      "explanation": "string"
    }
  ]
}

MCQ RULES:
- mcqs MUST be an array containing 5 to 10 items.
- Every MCQ must have exactly 4 unique non-empty option strings.
- answer MUST be the zero-based integer 0, 1, 2 or 3.
- Exactly one option must be correct.
- explanation MUST be a non-empty string.
- Every question must belong only to the authoritative topic.
- Questions must be meaningfully different from each other.
- Do not create duplicate or near-duplicate questions.

FINAL CHECK:
1. Valid JSON.
2. mcqs is an array.
3. mcqs contains at least 5 and at most 10 items.
4. Every MCQ has exactly 4 options.
5. Every option is non-empty and unique.
6. answer is 0, 1, 2 or 3.
7. Exactly one option is correct.
8. Every explanation is non-empty.
9. Every question belongs only to the authoritative topic.
10. No repetitive questions.
11. The number of questions reflects the conceptual breadth of the topic.

DAY:
${JSON.stringify(day)}

TOPIC:
${JSON.stringify(topic)}
`;
}
