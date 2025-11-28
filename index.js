// index.js
const express = require("express");
const axios = require("axios");
const fileUpload = require("express-fileupload");
const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  abortOnLimit: true
}));

// Helper: fetch HTML and return screenshot base64s
async function fetchScreenshotsBase64FromPlayStorePackage(packageName, maxScreens = 6) {
  const playUrl = `https://play.google.com/store/apps/details?id=${packageName}&hl=en&gl=US`;
  // include User-Agent to avoid 403
  const resp = await axios.get(playUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    },
    timeout: 15_000
  });

  const html = resp.data;

  // Regex to match high-res googleusercontent screenshot URLs that end with =wXXX-hYYY
  const regex = /https:\/\/play-lh\.googleusercontent\.com\/[^\s"']+?=w\d+-h\d+/g;
  const matches = html.match(regex) || [];

  // Filter duplicates & exclude obvious icons
  const screenshots = [...new Set(matches)].filter(u => !u.includes("icon") && (u.includes("=w") || u.includes("=s")));

  if (!screenshots.length) {
    // Try broader fallback for older format
    const fallbackRegex = /https:\/\/play-lh\.googleusercontent\.com\/[^\s"']+/g;
    const fallback = (html.match(fallbackRegex) || []).filter(u => u.includes("w") && u.includes("-h"));
    if (fallback.length) {
      screenshots.push(...[...new Set(fallback)]);
    }
  }

  const chosen = screenshots.slice(0, maxScreens);

  // download and convert to base64
  const base64s = [];
  for (const url of chosen) {
    try {
      const bin = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
      const b64 = Buffer.from(bin.data, "binary").toString("base64");
      base64s.push(`data:image/png;base64,${b64}`);
    } catch (err) {
      // skip any that fail
      console.warn("Failed to download image:", url, err.message);
    }
  }

  return base64s;
}

// POST /scrape
// body: { "url": "https://play.google.com/store/apps/details?id=com.todoist" }
app.post("/scrape", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing url in body" });

    let pkg;
    try {
      const parsed = new URL(url);
      pkg = parsed.searchParams.get("id");
    } catch (_) {
      // if not parseable, try market://
      if (url.startsWith("market://details?id=")) {
        pkg = url.split("id=")[1];
      }
    }
    if (!pkg) return res.status(400).json({ error: "Invalid Play Store URL (no id param)" });

    // fetch images
    const screens = await fetchScreenshotsBase64FromPlayStorePackage(pkg, 6);
    return res.json({ package: pkg, screenshots: screens });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

// POST /upload-screens
// form-data: files[] — returns base64 list (for manual upload)
app.post("/upload-screens", async (req, res) => {
  try {
    if (!req.files || !req.files.files) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const files = Array.isArray(req.files.files) ? req.files.files : [req.files.files];
    const base64s = files.map(f => {
      const b64 = Buffer.from(f.data).toString("base64");
      return `data:${f.mimetype};base64,${b64}`;
    });
    res.json({ screenshots: base64s });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// health
app.get("/", (req, res) => res.send("Play Store Scraper running"));

// Listen
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
