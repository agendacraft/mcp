import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const metadata = JSON.parse(await readFile(".cache/bundle-meta.json", "utf8"));
const packageRoots = new Set();
for (const input of Object.keys(metadata.inputs)) {
  const marker = input.lastIndexOf("node_modules/");
  if (marker < 0) continue;
  const prefix = input.slice(0, marker + "node_modules/".length);
  const parts = input.slice(marker + "node_modules/".length).split("/");
  const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  packageRoots.add(prefix + name);
}
const notices = [];
for (const root of packageRoots) {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const names = await readdir(root);
  const licenseNames = names.filter((name) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  if (licenseNames.length === 0) throw new Error(`Missing bundled license: ${manifest.name}`);
  const texts = [];
  for (const name of licenseNames.sort()) {
    texts.push(
      `### ${name}\n\n\`\`\`text\n${(await readFile(path.join(root, name), "utf8")).trim()}\n\`\`\``
    );
  }
  notices.push({
    name: manifest.name,
    text: `## ${manifest.name}@${manifest.version}\n\nLicense: ${typeof manifest.license === "string" ? manifest.license : JSON.stringify(manifest.license)}\n\n${texts.join("\n\n")}`,
  });
}
notices.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(
  "THIRD_PARTY_NOTICES.md",
  "# Third-party notices\n\nGenerated from packages included in the bundled CLI. The MCP project's MIT license does not replace these upstream licenses. Regenerate with `pnpm build`.\n\n" +
    notices.map((notice) => notice.text).join("\n\n") +
    "\n"
);
