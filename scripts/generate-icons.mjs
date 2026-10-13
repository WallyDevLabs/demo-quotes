// One-off: renders the PWA icons into public/icons. Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#4F46E5"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 512})">
    <path d="M150 190 L96 256 L150 322" fill="none" stroke="#fff" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M362 190 L416 256 L362 322" fill="none" stroke="#fff" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="256" y="302" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="190" fill="#86F2E4">R</text>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
const jobs = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["icon-maskable-512.png", 512, 64], // extra safe-zone padding for maskable
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(svg(size, pad))).png().toFile(`public/icons/${name}`);
}
console.log("icons written");
