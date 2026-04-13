#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { program } = require("commander");

const VERSION = "1.0.0";

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".env",
  ".env.local",
  ".env.production",
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".next",
  ".nuxt",
  "dist",
  "build",
  ".cache",
];

const LANGUAGE_MAP = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", java: "java", cpp: "cpp", c: "c",
  cs: "csharp", go: "go", rs: "rust", php: "php", swift: "swift",
  kt: "kotlin", html: "html", css: "css", scss: "scss", json: "json",
  yaml: "yaml", yml: "yaml", md: "markdown", sh: "bash", bash: "bash",
  toml: "toml", xml: "xml", sql: "sql", graphql: "graphql",
};

function getLanguage(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return LANGUAGE_MAP[ext] || "";
}

function getAllFiles(dirPath, ignoreList, fileList = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(process.cwd(), fullPath);

    if (
      ignoreList.some(
        (ig) => entry.name === ig || relativePath.startsWith(ig + path.sep) || relativePath === ig
      )
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      getAllFiles(fullPath, ignoreList, fileList);
    } else if (entry.isFile()) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

function isBinaryFile(filePath) {
  try {
    const buffer = Buffer.alloc(512);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function matchesExtensions(filePath, exts) {
  if (!exts || exts.length === 0) return true;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return exts.map((e) => e.replace(/^\./, "").toLowerCase()).includes(ext);
}

function matchesPattern(filePath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const rel = path.relative(process.cwd(), filePath);
  return patterns.some((p) => rel.includes(p) || path.basename(filePath).includes(p));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printBanner() {
  console.log(`
╔══════════════════════════════════╗
║        repomeld  v${VERSION}         ║
║   Meld your repo into one file   ║
╚══════════════════════════════════╝`);
}

function buildHeader(style, relativePath, filePath, lineCount, showMeta) {
  const lang = getLanguage(filePath);
  const size = formatSize(fs.statSync(filePath).size);
  const meta = showMeta ? `  [${lineCount} lines | ${size}${lang ? " | " + lang : ""}]` : "";

  if (style === "markdown") {
    return `\n## 📄 ${relativePath}${meta}\n\n\`\`\`${lang}\n`;
  }
  if (style === "minimal") {
    return `\n# ${relativePath}\n`;
  }
  // default: banner style
  const divider = "─".repeat(60);
  return `\n${divider}\n  FILE: ${relativePath}${meta}\n${divider}\n\n`;
}

function buildFooter(style) {
  if (style === "markdown") return "\n```\n";
  return "\n";
}

function buildTableOfContents(files, cwd) {
  let toc = "TABLE OF CONTENTS\n" + "═".repeat(60) + "\n";
  files.forEach((f, i) => {
    const rel = path.relative(cwd, f);
    toc += `  ${String(i + 1).padStart(3, " ")}. ${rel}\n`;
  });
  toc += "═".repeat(60) + "\n\n";
  return toc;
}

function repomeld(options) {
  printBanner();

  const cwd = process.cwd();
  const outputFile = path.resolve(cwd, options.output);
  const ignoreList = [...DEFAULT_IGNORE, ...(options.ignore || [])];
  const filterExts = options.ext || [];
  const maxFileSizeBytes = (parseFloat(options.maxSize) || 500) * 1024;
  const headerStyle = options.style || "banner";
  const showMeta = !options.noMeta;
  const showToc = !options.noToc;
  const dryRun = options.dryRun || false;
  const include = options.include || [];
  const exclude = options.exclude || [];
  const linesBefore = parseInt(options.linesBefore) || 0;
  const linesAfter = parseInt(options.linesAfter) || 0;

  console.log(`\n  📂 Source  : ${cwd}`);
  console.log(`  📄 Output  : ${path.relative(cwd, outputFile)}`);
  console.log(`  🎨 Style   : ${headerStyle}`);
  if (filterExts.length) console.log(`  🔍 Filter  : .${filterExts.join(", .")}`);
  if (dryRun) console.log(`  🧪 Dry run : no file will be written`);
  console.log();

  let allFiles = getAllFiles(cwd, ignoreList);

  // Filter by extension
  if (filterExts.length) {
    allFiles = allFiles.filter((f) => matchesExtensions(f, filterExts));
  }

  // Include pattern filter
  if (include.length) {
    allFiles = allFiles.filter((f) => matchesPattern(f, include));
  }

  // Exclude pattern filter
  if (exclude.length) {
    allFiles = allFiles.filter((f) => !matchesPattern(f, exclude));
  }

  // Remove output file from list
  allFiles = allFiles.filter((f) => path.resolve(f) !== outputFile);

  if (allFiles.length === 0) {
    console.log("  ⚠️  No matching files found.\n");
    return;
  }

  let combinedContent = "";
  let skipped = 0;
  let included = 0;
  let totalLines = 0;
  const includedFiles = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(cwd, filePath);

    if (isBinaryFile(filePath)) {
      console.log(`  ⏭  Binary  : ${relativePath}`);
      skipped++;
      continue;
    }

    const stat = fs.statSync(filePath);
    if (stat.size > maxFileSizeBytes) {
      console.log(`  ⏭  Too large: ${relativePath} (${formatSize(stat.size)})`);
      skipped++;
      continue;
    }

    try {
      let content = fs.readFileSync(filePath, "utf8");

      // Trim leading/trailing blank lines if requested
      if (options.trim) {
        content = content.trim();
      }

      // Slice specific lines
      if (linesBefore > 0 || linesAfter > 0) {
        const lines = content.split("\n");
        const start = linesBefore;
        const end = linesAfter > 0 ? lines.length - linesAfter : lines.length;
        content = lines.slice(start, end).join("\n");
      }

      const lineCount = content.split("\n").length;
      totalLines += lineCount;
      includedFiles.push(filePath);

      combinedContent += buildHeader(headerStyle, relativePath, filePath, lineCount, showMeta);
      combinedContent += content;
      combinedContent += buildFooter(headerStyle);

      console.log(`  ✅ ${relativePath}`);
      included++;
    } catch (err) {
      console.log(`  ❌ Error: ${relativePath} — ${err.message}`);
      skipped++;
    }
  }

  // Build final output
  let finalOutput = "";

  // Top-level comment
  const timestamp = new Date().toISOString();
  finalOutput += `# Generated by repomeld v${VERSION}\n`;
  finalOutput += `# Date     : ${timestamp}\n`;
  finalOutput += `# Source   : ${cwd}\n`;
  finalOutput += `# Files    : ${included}\n`;
  finalOutput += `# Lines    : ${totalLines}\n\n`;

  if (showToc) {
    finalOutput += buildTableOfContents(includedFiles, cwd);
  }

  finalOutput += combinedContent;

  if (!dryRun) {
    fs.writeFileSync(outputFile, finalOutput, "utf8");
  }

  const outputSize = formatSize(Buffer.byteLength(finalOutput, "utf8"));

  console.log(`
  ✨ repomeld complete!
  ─────────────────────────────
  ✅ Included : ${included} files
  ⏭  Skipped  : ${skipped} files
  📏 Lines    : ${totalLines}
  💾 Size     : ${outputSize}
  📄 Output   : ${options.output}${dryRun ? "  (dry run — not written)" : ""}
  `);
}

// ─── CLI Definition ───────────────────────────────────────────

program
  .name("repomeld")
  .description("Meld your entire repo into a single file — perfect for AI context, code reviews & sharing")
  .version(VERSION)

  // Output
  .option("-o, --output <filename>",        "Output file name",                        "repomeld_output.txt")

  // Filtering
  .option("-e, --ext <exts...>",            "Only include specific extensions          e.g. --ext js ts jsx")
  .option("--include <patterns...>",        "Only include files matching patterns      e.g. --include src/")
  .option("--exclude <patterns...>",        "Exclude files matching patterns           e.g. --exclude test spec")
  .option("-i, --ignore <names...>",        "Extra folders/files to ignore             e.g. --ignore dist .next")
  .option("--max-size <kb>",                "Skip files larger than N KB (default 500)","500")

  // Formatting
  .option("-s, --style <style>",            "Header style: banner | markdown | minimal (default: banner)", "banner")
  .option("--no-toc",                       "Disable table of contents")
  .option("--no-meta",                      "Hide file metadata (lines, size, lang)")
  .option("--trim",                         "Trim leading/trailing whitespace per file")

  // Advanced
  .option("--lines-before <n>",             "Skip first N lines of each file")
  .option("--lines-after <n>",              "Skip last N lines of each file")
  .option("--dry-run",                      "Preview what would be included — don't write output")

  .action((options) => {
    repomeld(options);
  });

program.parse(process.argv);