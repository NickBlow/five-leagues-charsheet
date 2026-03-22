import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required to generate the favicon.");
}

const outputPath = path.resolve("public/favicon.png");

const prompt = [
  "Create a small, iconic fantasy map emblem for a website favicon.",
  "Show a mounted warband horse silhouette over a parchment-map medallion.",
  "Antique cartography style, sepia ink linework, subtle teal accent, transparent background.",
  "Single centered icon, no text, no frame, crisp readable silhouette at tiny sizes.",
  "Leave every non-icon pixel fully transparent.",
].join(" ");

const response = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    size: "1024x1024",
    background: "transparent",
    output_format: "png",
    prompt,
  }),
});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`OpenAI image generation failed (${response.status}): ${errorText}`);
}

const payload = await response.json();
const imageBase64 = payload?.data?.[0]?.b64_json;

if (!imageBase64) {
  throw new Error("OpenAI did not return favicon image data.");
}

await writeFile(outputPath, Buffer.from(imageBase64, "base64"));
console.log(`Generated favicon at ${outputPath}`);
