import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

async function main() {
  const html = path.resolve("docs/one-pager.html");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1123, height: 794 } });
  await page.goto(pathToFileURL(html).href);
  await page.pdf({ path: "docs/one-pager.pdf", format: "A4", landscape: true, printBackground: true, pageRanges: "1" });
  await page.screenshot({ path: "docs/one-pager.png", fullPage: false });
  const overflow = await page.evaluate(() => document.body.scrollHeight > window.innerHeight + 2);
  await browser.close();
  console.log(`Rendered docs/one-pager.pdf${overflow ? " (WARNING: content overflows one page)" : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
