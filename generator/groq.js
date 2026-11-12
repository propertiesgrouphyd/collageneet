const GROQ_API_URL =
  "https://api.groq.com/openai/v1/chat/completions";

const MODEL =
  process.env.GROQ_MODEL ||
  "openai/gpt-oss-120b";


function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}


/*
 * ------------------------------------------------------
 * GROQ RATE-LIMIT RESET DELAY
 * ------------------------------------------------------
 *
 * Priority:
 *
 * 1. retry-after
 * 2. x-ratelimit-reset-tokens
 * 3. safe 61-second fallback
 */
function getResetDelay(response) {
  const retryAfter =
    response.headers.get(
      "retry-after"
    );

  if (retryAfter) {
    const seconds =
      Number.parseFloat(
        retryAfter
      );

    if (Number.isFinite(seconds)) {
      return Math.max(
        1000,
        Math.ceil(
          seconds * 1000
        ) + 1000
      );
    }
  }


  const resetTokens =
    response.headers.get(
      "x-ratelimit-reset-tokens"
    );

  if (resetTokens) {
    const match =
      resetTokens.match(
        /(\d+(?:\.\d+)?)(ms|s|m|h)?/
      );

    if (match) {
      const value =
        Number.parseFloat(
          match[1]
        );

      const unit =
        match[2] || "s";

      let milliseconds =
        value * 1000;

      if (unit === "ms") {
        milliseconds = value;
      }

      else if (unit === "m") {
        milliseconds =
          value * 60 * 1000;
      }

      else if (unit === "h") {
        milliseconds =
          value * 60 * 60 * 1000;
      }

      return Math.max(
        1000,
        Math.ceil(
          milliseconds
        ) + 1000
      );
    }
  }


  /*
   * Safe fallback when Groq does not provide
   * a usable reset header.
   */
  return 61000;
}


/*
 * ------------------------------------------------------
 * GROQ API REQUEST
 * ------------------------------------------------------
 */
async function request(
  prompt,
  maxTokens
) {
  const apiKey =
    process.env.GROQ_API_KEY;


  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set."
    );
  }


  const response =
    await fetch(
      GROQ_API_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${apiKey}`
        },

        body: JSON.stringify({
          model: MODEL,

          temperature: 0.15,

          max_tokens:
            maxTokens,

          response_format: {
            type: "json_object"
          },

          messages: [
            {
              role: "system",

              content:
                "You are a precise NEET-UG educational content generator. " +
                "Return ONLY valid JSON. " +
                "Never invent syllabus content. " +
                "Follow the requested JSON structure exactly. " +
                "Never return markdown, code fences, comments, or explanatory text. " +
                "For lesson generation, learningOutcome MUST ALWAYS be a JSON array of strings. " +
                "For MCQ generation, mcqs MUST be an array and answer MUST be a zero-based integer 0, 1, 2, or 3."
            },

            {
              role: "user",

              content:
                prompt
            }
          ]
        })
      }
    );


  const text =
    await response.text();


  /*
   * ----------------------------------------------------
   * HTTP ERROR
   * ----------------------------------------------------
   */
  if (!response.ok) {
    let message =
      text;


    try {
      const parsed =
        JSON.parse(text);

      message =
        parsed?.error?.message ||
        parsed?.error?.code ||
        text;

    } catch {
      /*
       * Keep raw response text.
       */
    }


    const error =
      new Error(
        `Groq HTTP ${response.status}: ${message}`
      );


    error.status =
      response.status;

    error.response =
      response;

    error.resetDelay =
      getResetDelay(
        response
      );


    throw error;
  }


  /*
   * ----------------------------------------------------
   * PARSE GROQ API RESPONSE
   * ----------------------------------------------------
   */
  let result;


  try {
    result =
      JSON.parse(text);

  } catch {
    throw new Error(
      "Groq returned invalid API JSON."
    );
  }


  const content =
    result?.choices?.[0]?.message?.content;


  if (
    !content ||
    !content.trim()
  ) {
    throw new Error(
      "Groq returned empty content."
    );
  }


  return content.trim();
}


/*
 * ------------------------------------------------------
 * PARSE MODEL JSON
 * ------------------------------------------------------
 *
 * The API response itself is JSON, but the model's
 * message content is another JSON document.
 *
 * Markdown fences are removed defensively if the model
 * ever returns them despite the system instruction.
 */
function parseJson(text) {
  let cleaned =
    String(text).trim();


  if (
    cleaned.startsWith("```")
  ) {
    cleaned =
      cleaned
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/,
          ""
        )
        .replace(
          /\s*```$/,
          ""
        )
        .trim();
  }


  try {
    return JSON.parse(
      cleaned
    );

  } catch {
    throw new Error(
      "Groq returned invalid lesson/MCQ JSON content."
    );
  }
}


/*
 * ------------------------------------------------------
 * RETRY GROQ REQUEST
 * ------------------------------------------------------
 *
 * CRITICAL BEHAVIOR:
 *
 * 429:
 *   Wait for token reset.
 *   Retry EXACT SAME request.
 *
 * Temporary server errors:
 *   Retry SAME request.
 *
 * Invalid model JSON:
 *   Retry SAME request.
 *
 * 400:
 *   Fatal.
 *   Do NOT retry forever because the exact same
 *   malformed request will normally produce the
 *   exact same 400 response.
 *
 * 413:
 *   Fatal because the request is too large.
 *
 * Network/fetch errors:
 *   Retry SAME request because the request may never
 *   have reached Groq.
 */
async function callWithRetry(
  prompt,
  maxTokens,
  label
) {
  let attempt = 0;


  while (true) {
    attempt++;


    try {
      console.log(
        `${label}: Groq attempt ${attempt}`
      );


      const raw =
        await request(
          prompt,
          maxTokens
        );


      return parseJson(
        raw
      );


    } catch (error) {
      const status =
        error?.status;


      /*
       * ------------------------------------------------
       * 429 — RATE LIMIT / TPM
       * ------------------------------------------------
       *
       * NEVER skip the current request.
       *
       * Wait until tokens become available and send
       * the EXACT SAME prompt again.
       */
      if (
        status === 429
      ) {
        const delay =
          error?.resetDelay ||
          61000;


        const seconds =
          Math.ceil(
            delay / 1000
          );


        console.log("");

        console.log(
          `${label}: Groq rate limit reached.`
        );

        console.log(
          `${label}: Waiting ${seconds} seconds for tokens to become available...`
        );


        await sleep(
          delay
        );


        console.log(
          `${label}: Token wait complete. Retrying the SAME request...`
        );


        continue;
      }


      /*
       * ------------------------------------------------
       * TEMPORARY GROQ ERRORS
       * ------------------------------------------------
       *
       * Retry the SAME request.
       */
      if (
        status === 408 ||
        status === 409 ||
        status === 422 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504
      ) {
        const delay =
          Math.min(
            60000,
            Math.max(
              5000,
              attempt * 5000
            )
          );


        console.log(
          `${label}: Temporary Groq error (${status}). Waiting ${Math.ceil(delay / 1000)} seconds...`
        );


        await sleep(
          delay
        );


        continue;
      }


      /*
       * ------------------------------------------------
       * INVALID MODEL JSON / NETWORK ERROR
       * ------------------------------------------------
       *
       * When there is no HTTP status, this is normally
       * a network/fetch error or a malformed model
       * response.
       *
       * Retry the SAME request.
       */
      if (!status) {
        const delay =
          Math.min(
            60000,
            Math.max(
              5000,
              attempt * 5000
            )
          );


        console.log(
          `${label}: ${error.message}`
        );

        console.log(
          `${label}: Retrying the SAME request after ${Math.ceil(delay / 1000)} seconds...`
        );


        await sleep(
          delay
        );


        continue;
      }


      /*
       * ------------------------------------------------
       * 400 — BAD REQUEST
       * ------------------------------------------------
       *
       * Do NOT retry forever.
       *
       * The request itself must be corrected.
       */
      if (
        status === 400
      ) {
        throw error;
      }


      /*
       * ------------------------------------------------
       * 413 — REQUEST TOO LARGE
       * ------------------------------------------------
       *
       * Retrying the identical request cannot solve
       * the size problem.
       */
      if (
        status === 413
      ) {
        throw error;
      }


      /*
       * ------------------------------------------------
       * UNEXPECTED HTTP ERROR
       * ------------------------------------------------
       *
       * Retry the SAME request rather than silently
       * losing the current lesson/topic.
       */
      const delay =
        Math.min(
          60000,
          Math.max(
            5000,
            attempt * 5000
          )
        );


      console.log(
        `${label}: Groq HTTP ${status}. Retrying the SAME request after ${Math.ceil(delay / 1000)} seconds...`
      );


      await sleep(
        delay
      );
    }
  }
}


/*
 * ------------------------------------------------------
 * LESSON GENERATION
 * ------------------------------------------------------
 */
export async function generateLesson(
  prompt
) {
  return callWithRetry(
    prompt,
    3500,
    "Lesson generation"
  );
}


/*
 * ------------------------------------------------------
 * TOPIC MCQ GENERATION
 * ------------------------------------------------------
 */
export async function generateTopicMcqs(
  prompt
) {
  return callWithRetry(
    prompt,
    2500,
    "MCQ generation"
  );
}
