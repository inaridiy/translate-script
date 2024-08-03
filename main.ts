import Anthropic from "npm:@anthropic-ai/sdk";
import { sha256 } from "https://denopkg.com/chiefbiiko/sha256@v1.0.0/mod.ts";

const MODEL_NAME = Deno.env.get("ANTHROPIC_MODEL_NAME") ??
  "claude-3-5-sonnet-20240620";
const MAX_OUTPUT_TOKEN = Number(
  Deno.env.get("MAX_OUTPUT_TOKEN") ?? 4096,
);
const MAX_ITERATIONS = Number(Deno.env.get("MAX_ITERATIONS") ?? 10);
const TARGET_LANGUAGE = Deno.env.get("TARGET_LANGUAGE") ?? "japanese";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ORIGINAL_DIR = Deno.env.get("ORIGINAL_DIR") ?? "./";

const TRANSLATTE_PROMPT =
  `You are tasked with translating a technical Markdown document from English to a specified target language. Your goal is to produce an accurate and natural-sounding translation while preserving the original Markdown formatting and technical terminology.

Here is the Markdown document to be translated:

<markdown_document>
{{MARKDOWN_DOCUMENT}}
</markdown_document>

The target language for this translation is:

<target_language>
{{TARGET_LANGUAGE}}
</target_language>

Please follow these guidelines when translating:

1. Preserve all Markdown syntax and formatting, including headings, lists, code blocks, and links.
2. Maintain the original structure and organization of the document.
3. Translate the content accurately, ensuring that the meaning and tone of the original text are preserved.
4. For technical terms, consider the following:
   a. If there is a widely accepted translation in the target language, use it.
   b. If no standard translation exists, you may keep the original English term and provide a translation in parentheses the first time it appears.
   c. For acronyms, provide the full translated term with the original acronym in parentheses on first use.
5. Do not translate content within code blocks or code snippets.
6. Ensure that any placeholders or variables in the original text remain unchanged.
7. Adapt any culture-specific examples or references to be appropriate for the target language audience, if necessary.

Before you begin the translation, take a moment to review the entire document and identify any potential challenges or areas that may require special attention.

Please provide your translation inside <translated_document> tags. Ensure that the translated document maintains the original Markdown formatting and structure.`;

const anthropic = new Anthropic({ apiKey: API_KEY });
Deno.mkdirSync(`./${TARGET_LANGUAGE}`, { recursive: true });

const files = Array.from(Deno.readDirSync(ORIGINAL_DIR))
  .map((file) => file.name)
  .filter((file) => file.endsWith(".md"));

for (const file of files) {
  const savePath = `./${TARGET_LANGUAGE}/${file}`;
  const existing = safeReadTextFileSync(savePath);
  const markdown = Deno.readTextFileSync(file);
  const hash = sha256(markdown, "utf8", "hex");

  if (existing) {
    const existingMeta = existing.split("\n")[1];
    const existingHash = existingMeta.split(":")[1].trim();

    if (hash === existingHash) {
      console.log(`Skipping ${file} as it has already been translated.`);
      continue;
    }
  }

  console.log(`Translating ${file}...`);
  const translation = await translateMarkdown(
    anthropic,
    TARGET_LANGUAGE,
    markdown,
  );
  const meta = `---\noriginal: ${hash}\n---\n`;
  Deno.writeTextFileSync(savePath, meta + translation);
}

async function translateMarkdown(
  client: Anthropic,
  target: string,
  markdown: string,
) {
  const prompt = formatPrompt(TRANSLATTE_PROMPT, {
    MARKDOWN_DOCUMENT: markdown,
    TARGET_LANGUAGE: target,
  });

  let result = "";
  const messages = [{ role: "user", content: prompt }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL_NAME,
      max_tokens: MAX_OUTPUT_TOKEN,
      messages,
      temperature: 0,
    });

    const content = response.content[0].text as string;

    const translated = content.includes("<translated_document>")
      ? content
        .split("<translated_document>")[1]
        .split("</translated_document>")[0].trim()
      : content
        .split("</translated_document>")[0].trim();

    const lastline = result.split("\n").slice(-1)[0];
    if (translated.startsWith(lastline)) {
      result = result.slice(0, -lastline.length) + "\n" + translated;
    } else {
      result += "\n" + translated;
    }

    if (content.includes("</translated_document>")) {
      break;
    }

    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: "continue with <translated_document>",
    });
  }

  return result;
}

type ParsePrompt<P extends string> = P extends
  `${infer _A}{{${infer B}}}${infer C}`
  ? { [K in B | keyof ParsePrompt<C>]: string }
  : Record<never, never>;

function formatPrompt<P extends string>(
  prompt: P,
  injects: ParsePrompt<P>,
): string {
  return Object.entries(injects).reduce<string>(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value as string),
    prompt,
  );
}

function safeReadTextFileSync(path: string): string | null {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return null;
  }
}
