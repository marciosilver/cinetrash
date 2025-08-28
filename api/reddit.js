// api/reddit.js
const SUBS = [
  "movies",
  "television",
  "badMovies", 
  "moviescirclejerk",
  "MarvelStudios",
  "MovieDetails", // adicionei mais subs relevantes
  "flicks",
  "TrueFilm"
];

function isDecent(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 30) return false;
  // corta spam/links puros
  if (/https?:\/\//i.test(t) && t.length < 120) return false;
  // evita spoilers gigantescos nas buscas iniciais
  if (t.length > 1200) return false;
  // filtra lixo comum
  if (/(buy followers|crypto|promo code|upvote|karma)/i.test(t)) return false;
  // evita posts automods
  if (/^(AutoModerator|removed|deleted|\[removed\]|\[deleted\])/i.test(t)) return false;
  return true;
}

async function getJson(url) {
  try {
    const r = await fetch(url, {
      headers: {
        // User-Agent mais genérico para evitar bloqueios
        "User-Agent": "Mozilla/5.0 (compatible; CineTrash/1.0; +https://yoursite.com/contact)",
        "Accept": "application/json",
      },
    });
    
    if (!r.ok) {
      console.warn(`Reddit HTTP ${r.status} for ${url}`);
      return null;
    }
    
    const data = await r.json();
    return data;
  } catch (error) {
    console.warn(`Reddit fetch error for ${url}:`, error.message);
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers primeiro
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { q = "", year = "", type = "", imdb = "" } = req.query || {};
    const queries = [];

    // consultas principais - melhoradas
    if (q) {
      const base = `${q} ${year}`.trim();
      queries.push(encodeURIComponent(`${base} review`));
      queries.push(encodeURIComponent(`${base} discussion`));
      
      if (type === "movie") {
        queries.push(encodeURIComponent(`${base} movie`));
        queries.push(encodeURIComponent(`${base} film`));
      }
      if (type === "tv") {
        queries.push(encodeURIComponent(`${base} tv series`));
        queries.push(encodeURIComponent(`${base} show`));
      }
      
      // busca genérica para ambos
      if (type === "" || type === "both") {
        queries.push(encodeURIComponent(base));
      }
    }
    
    if (imdb) {
      queries.push(encodeURIComponent(imdb));
    }

    if (!queries.length) {
      res.status(200).json({ quotes: [], debug: "No queries provided" });
      return;
    }

    const posts = [];
    const LIMIT_POSTS = 6; // aumentei um pouco

    // Busca com timeout e limite de rate
    const searchWithTimeout = async (url, timeout = 5000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const data = await getJson(url);
        clearTimeout(timeoutId);
        return data;
      } catch (error) {
        clearTimeout(timeoutId);
        return null;
      }
    };

    // Busca em /search.json global + por sub
    for (const qEnc of queries) {
      // global search primeiro
      try {
        const url = `https://www.reddit.com/search.json?q=${qEnc}&sort=top&t=year&limit=8&raw_json=1`;
        const data = await searchWithTimeout(url);
        if (data?.data?.children) {
          data.data.children.forEach((c) => {
            if (c?.data && isDecent(c.data.selftext || c.data.title)) {
              posts.push(c.data);
            }
          });
        }
        
        // delay entre requests para ser gentil com Reddit
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.warn(`Global search failed for ${qEnc}:`, error.message);
      }

      // busca por subreddits específicos
      for (const sub of SUBS.slice(0, 4)) { // limita subs para não sobrecarregar
        try {
          const url = `https://www.reddit.com/r/${sub}/search.json?q=${qEnc}&restrict_sr=1&sort=top&t=year&limit=5&raw_json=1`;
          const data = await searchWithTimeout(url);
          if (data?.data?.children) {
            data.data.children.forEach((c) => {
              if (c?.data && isDecent(c.data.selftext || c.data.title)) {
                posts.push(c.data);
              }
            });
          }
          
          // delay entre subreddits
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
          console.warn(`Sub search failed for ${sub}/${qEnc}:`, error.message);
        }
      }
    }

    // remove duplicados e ordena por upvotes
    const seen = new Set();
    const topPosts = posts
      .filter((p) => p && !seen.has(p.id) && (p.num_comments > 0 || isDecent(p.selftext)))
      .sort((a, b) => (b.ups || 0) - (a.ups || 0))
      .slice(0, LIMIT_POSTS)
      .map((p) => (seen.add(p.id), p));

    // coleta comentários bons de cada post
    const quotes = [];
    
    for (const p of topPosts) {
      try {
        let permalink = p.permalink;
        if (!permalink) continue;
        
        // limpa permalink
        permalink = permalink.replace(/\/+$/, "");
        if (!permalink.startsWith('/')) permalink = '/' + permalink;

        const threadUrl = `https://www.reddit.com${permalink}.json?limit=30&raw_json=1`;
        const thread = await searchWithTimeout(threadUrl);
        
        if (!thread || !Array.isArray(thread) || thread.length < 2) {
          // se não conseguir pegar comentários, usa o próprio post se for bom
          if (isDecent(p.selftext)) {
            quotes.push({
              text: p.selftext.slice(0, 300), // limita tamanho
              author: p.author || "anon",
              score: p.ups || 0,
              link: `https://www.reddit.com${permalink}`,
            });
          }
          continue;
        }

        const comments = thread[1]?.data?.children
          ?.map((ch) => ch?.data)
          ?.filter(Boolean) || [];

        // filtra e ordena comentários
        const goodComments = comments
          .filter((c) => c && isDecent(c.body) && !c.stickied)
          .sort((a, b) => (b.ups || 0) - (a.ups || 0))
          .slice(0, 2); // max 2 por post

        for (const c of goodComments) {
          quotes.push({
            text: c.body.slice(0, 300), // limita tamanho
            author: c.author || "anon",
            score: c.ups || 0,
            link: `https://www.reddit.com${permalink}`,
          });
          
          if (quotes.length >= 8) break; // limite total
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.warn(`Thread fetch failed for ${p.id}:`, error.message);
      }
      
      if (quotes.length >= 8) break;
    }

    // resposta estruturada como o frontend espera
    const response = {
      quotes: quotes.slice(0, 6), // limita final
      debug: {
        totalPosts: posts.length,
        uniquePosts: topPosts.length,
        totalQuotes: quotes.length,
        queries: queries.length
      }
    };

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300"); // cache menor
    res.status(200).json(response);
    
  } catch (err) {
    console.error("Reddit API error:", err);
    res.status(200).json({ 
      quotes: [], 
      error: "Reddit search temporarily unavailable" 
    });
  }
}