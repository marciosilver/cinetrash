// api/reddit.js
export default async function handler(req, res) {
  const q = (req.query.q || "").toString().slice(0, 120);
  const type = (req.query.type || "movie").toString();

  if (!q) {
    res.status(400).json({ quotes: [], error: "missing q" });
    return;
  }

  // Subreddits por tipo
  const subs = type === "tv"
    ? ["television", "tvdetails", "bestof"]
    : ["movies", "moviecritic", "badMovies"];

  // Busca tópicos relevantes
  const query = `"${q}" (discussion OR review OR thoughts OR opinion)`;
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "top",
    t: "all",
    limit: "3",
    raw_json: "1",
  });

  const UA = { "User-Agent": "CineTrash/1.0 (https://cinetrash.vercel.app)" };

  // helper simples para filtrar comentários
  const isDecent = (txt = "") => {
    if (!txt) return false;
    if (txt.length < 30 || txt.length > 300) return false;
    if (/(http|www\.)/i.test(txt)) return false;
    if (/\bspoiler\b/i.test(txt)) return false;
    if (/[*_#>`]/.test(txt)) return false;
    return true;
  };

  let candidatePosts = [];
  for (const sr of subs) {
    try {
      const url = `https://www.reddit.com/r/${sr}/search.json?${params.toString()}`;
      const r = await fetch(url, { headers: UA });
      if (!r.ok) continue;
      const j = await r.json();
      (j?.data?.children || []).forEach(p => {
        const d = p?.data;
        if (!d) return;
        if ((d.num_comments || 0) > 10 && (d.score || 0) >= 50) {
          candidatePosts.push({ permalink: d.permalink, score: d.score });
        }
      });
    } catch (_) { /* ignora subreddit com erro */ }
  }

  // únicos e no máx 3
  const seen = new Set();
  const posts = [];
  for (const p of candidatePosts) {
    if (seen.has(p.permalink)) continue;
    seen.add(p.permalink);
    posts.push(p);
    if (posts.length >= 3) break;
  }

  const quotes = [];
  for (const p of posts) {
    try {
      const url = `https://www.reddit.com${p.permalink}.json?limit=100&raw_json=1`;
      const r = await fetch(url, { headers: UA });
      if (!r.ok) continue;
      const j = await r.json();

      const comments = (j?.[1]?.data?.children || [])
        .map(c => c?.data)
        .filter(Boolean)
        .sort((a, b) => (b?.ups || 0) - (a?.ups || 0));

      for (const c of comments) {
        const body = c?.body || "";
        if (!isDecent(body)) continue;

        quotes.push({
          text: body,
          author: c?.author || "anon",
          score: c?.ups || 0,
          link: `https://www.reddit.com${p.permalink}`
        });

        if (quotes.length >= 5) break;
      }
      if (quotes.length >= 5) break;
    } catch (_) { /* ignora post com erro */ }
  }

  // CORS liberado p/ seu front
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600"); // cache CDN opcional
  res.status(200).json({ quotes });
}
