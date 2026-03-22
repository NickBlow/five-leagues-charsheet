import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const outputDir = path.resolve("public/marker-library");
const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const apiKey = process.env.OPENAI_API_KEY?.trim();
const requestedSlugs = new Set(process.argv.slice(2));

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required to generate marker art.");
}

const townVariants = [
  ["Fortified town", "town-fortified-town"],
  ["Sanctuary camp", "town-sanctuary-camp"],
  ["Old rubble", "town-old-rubble"],
  ["Scout camp", "town-scout-camp"],
  ["Trading post", "town-trading-post"],
  ["Ancient city", "town-ancient-city"],
  ["Mystic site", "town-mystic-site"],
];

const otherLocations = [
  ["delve", "delve"],
  ["enemy hideout", "enemy-hideout"],
  ["unknown location", "unknown-location"],
  ["monster lair", "monster-lair"],
  ["enemy camp", "enemy-camp"],
];

const specialMarkers = [["mounted adventuring party position", "party-horse"]];

const promptOverrides = {
  "town-fortified-town": "Depict a compact fortified desert town with crenellated walls, towers, and arid frontier details. Keep the silhouette crisp and isolated with no background residue or framing artifacts.",
  "town-sanctuary-camp": "Design it as a small refuge of plentiful water and green growth amid arid lands: spring water, palms, shade structures, tents, and oasis life. Avoid crosses, churches, halos, and Christian iconography.",
  "town-scout-camp": "Design it as a desert scout camp with dunes, expedition tents, sun-bleached cloth, dry scrub, and a frontier outpost feel. Avoid heraldry, fleur-de-lis symbols, and European court motifs.",
  "town-trading-post": "Depict a desert trading post with market awnings, pack goods, and caravan structures. Keep edges clean and avoid stray background artifacts or detached decorative marks.",
  "unknown-location": "Represent it as a hand-inked question mark symbol for an unknown location, with cartographic styling rather than a modern UI icon.",
  "party-horse": "Show a mounted horse or pack horse marker for the current party position, suited to a traveling warband on a parchment map.",
};

const stylePrompt = [
  "Match an antique fantasy map style.",
  "Use warm sepia parchment tones, dark ink linework, cross-hatching, and lightly desaturated color.",
  "Echo a hand-drawn wilderness atlas with rugged mountains, muted teal water accents, and weathered paper atmosphere.",
  "Single icon only, centered, transparent background, no label, no frame, no drop shadow, readable at small sizes.",
].join(" ");

await mkdir(outputDir, { recursive: true });

const manifestPath = path.join(outputDir, "manifest.json");
const manifest = await readManifest(manifestPath);
delete manifest["hidden-location"];

for (const [label, slug] of [...townVariants, ...otherLocations, ...specialMarkers]) {
  if (requestedSlugs.size > 0 && !requestedSlugs.has(slug)) {
    continue;
  }

  const prompt = [
    `Create a fantasy cartography map marker for ${withArticle(label)}.`,
    "Top-down or emblematic map-symbol view.",
    stylePrompt,
    promptOverrides[slug] || "",
  ].join(" ");

  console.log(`Generating ${slug}...`);
  const imageBase64 = await generateImage(prompt);
  const filePath = path.join(outputDir, `${slug}.png`);
  await writeFile(filePath, Buffer.from(imageBase64, "base64"));
  manifest[slug] = {
    label,
    file: `/marker-library/${slug}.png`,
    prompt,
  };
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${Object.keys(manifest).length} marker assets in ${outputDir}`);

async function generateImage(prompt) {
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
      prompt: `${prompt} Leave every non-icon pixel fully transparent alpha with no faint halo, no parchment rectangle, no background wash, and no leftover artifact marks. Output only the icon itself.`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI image generation failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const imageBase64 = payload?.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("OpenAI did not return image data.");
  }

  return imageBase64;
}

function withArticle(value) {
  return /^[aeiou]/i.test(value) ? `an ${value}` : `a ${value}`;
}

async function readManifest(manifestPath) {
  try {
    const existing = await readFile(manifestPath, "utf8");
    return JSON.parse(existing);
  } catch {
    return {};
  }
}
