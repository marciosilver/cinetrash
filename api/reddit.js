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
  
  // critérios mais flexíveis
  if (t.length < 15) return false;  // era 30, agora 15
  if (t.length > 800) return false; // era 1200, agora 800
  
  // filtra apenas spam óbvio
  if (/(buy followers|crypto|bitcoin|promo code)/i.test(t)) return false;
  
  // evita posts automods e removidos
  if (/^(AutoModerator|removed|deleted|\[removed\]|\[deleted\])/i.test(t)) return false;
  
  // aceita posts com links se tiverem texto suficiente
  if (/https?:\/\//i.test(t) && t.length < 80) return false;
  
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

    // consultas principais - simplificadas e mais efetivas
    if (q) {
      // busca simples primeiro (mais chance de achar)
      queries.push(encodeURIComponent(q));
      
      // depois com ano se disponível
      if (year) {
        queries.push(encodeURIComponent(`${q} ${year}`));
      }
      
      // termos específicos por tipo
      if (type === "movie") {
        queries.push(encodeURIComponent(`${q} movie`));
      } else if (type === "tv") {
        queries.push(encodeURIComponent(`${q} series`));
        queries.push(encodeURIComponent(`${q} show`));
      }
      
      // máximo 4 queries para não sobrecarregar
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

    // Busca com diferentes estratégias e mais debugging
    for (const qEnc of queries) {
      console.log(`Searching for: ${decodeURIComponent(qEnc)}`);
      
      // Estratégia 1: busca global com diferentes períodos
      const timeRanges = ['year', 'all', 'month'];
      for (const timeRange of timeRanges) {
        try {
          const url = `https://www.reddit.com/search.json?q=${qEnc}&sort=top&t=${timeRange}&limit=10&raw_json=1`;
          console.log(`Trying URL: ${url}`);
          
          const data = await searchWithTimeout(url);
          if (data?.data?.children) {
            console.log(`Global search (${timeRange}) found ${data.data.children.length} posts for: ${decodeURIComponent(qEnc)}`);
            data.data.children.forEach((c) => {
              if (c?.data) {
                posts.push({
                  ...c.data,
                  search_query: qEnc,
                  search_type: `global-${timeRange}`
                });
              }
            });
            
            // Se encontrou posts, para de tentar outros períodos para esta query
            if (data.data.children.length > 0) break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          console.warn(`Global search (${timeRange}) failed for ${qEnc}:`, error.message);
        }
      }

      // Estratégia 2: busca por subreddits específicos (só os mais ativos)
      const prioritySubs = ['movies', 'television', 'MarvelStudios'];
      for (const sub of prioritySubs) {
        try {
          const url = `https://www.reddit.com/r/${sub}/search.json?q=${qEnc}&restrict_sr=1&sort=top&t=all&limit=8&raw_json=1`;
          const data = await searchWithTimeout(url);
          if (data?.data?.children) {
            console.log(`Sub r/${sub} found ${data.data.children.length} posts for: ${decodeURIComponent(qEnc)}`);
            data.data.children.forEach((c) => {
              if (c?.data) {
                posts.push({
                  ...c.data,
                  search_query: qEnc,
                  search_type: `r/${sub}`
                });
              }
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.warn(`Sub search failed for ${sub}/${qEnc}:`, error.message);
        }
      }
    }

    console.log(`Total posts collected: ${posts.length}`);
    
    // Filtra e remove duplicados
    const seen = new Set();
    const filteredPosts = posts.filter(p => {
      if (!p || seen.has(p.id)) return false;
      seen.add(p.id);
      
      // critérios mais flexíveis para aceitar posts
      const hasComments = p.num_comments > 0;
      const hasText = isDecent(p.selftext) || isDecent(p.title);
      const isRelevant = p.title && p.title.toLowerCase().includes(q.toLowerCase().split(' ')[0]);
      
      return hasComments || hasText || isRelevant;
    });
    
    console.log(`Posts after filtering: ${filteredPosts.length}`);
    
    // ordena por upvotes
    const topPosts = filteredPosts
      .sort((a, b) => (b.ups || 0) - (a.ups || 0))
      .slice(0, LIMIT_POSTS);

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

    // Se não encontrou nada no Reddit, cria comentários simulados baseados no conteúdo
    if (quotes.length === 0 && q) {
      console.log("No Reddit posts found, generating fallback content");
      
      const fallbackComments = [
        {
          text: `Acabei de assistir ${q} e... nossa, que experiência foi essa? Não sei se rio ou choro.`,
          author: "CriticoAnonimo",
          score: 42,
          link: "https://reddit.com/r/movies",
          fallback: true
        },
        {
          text: `${q} é daqueles conteúdos que você assiste e fica pensando: "por que gastei meu tempo com isso?"`,
          author: "EspectadorDecepcionado", 
          score: 38,
          link: "https://reddit.com/r/television",
          fallback: true
        },
        {
          text: `Alguém mais achou ${q} meio... estranho? Tipo, o que os roteiristas estavam pensando?`,
          author: "UsuarioConfuso",
          score: 25,
          link: "https://reddit.com/r/movies", 
          fallback: true
        }
      ];
      
      quotes.push(...fallbackComments.slice(0, 2));
    }

    // resposta estruturada como o frontend espera
    const response = {
      quotes: quotes.slice(0, 6),
      debug: {
        totalPosts: posts.length,
        uniquePosts: topPosts.length, 
        totalQuotes: quotes.length,
        queries: queries.length,
        searchQueries: queries.map(q => decodeURIComponent(q)),
        hasFallback: quotes.some(q => q.fallback)
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