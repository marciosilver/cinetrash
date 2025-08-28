// api/reviews.js - Nova API que substitui a do Reddit
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'd76cf4268b2dcb1b8f8064ee015e7c5d';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const OMDB_BASE_URL = 'http://www.omdbapi.com';
const OMDB_API_KEY = process.env.OMDB_API_KEY || 'f8d3b773'; // Chave exemplo - troque pela sua

async function fetchWithTimeout(url, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CineTrash/1.0)',
        'Accept': 'application/json'
      }
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Busca reviews do TMDB
async function getTMDBReviews(tmdbId, type = 'movie') {
  if (!tmdbId) return [];
  
  try {
    const endpoint = type === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}/reviews?api_key=${TMDB_API_KEY}&language=en-US&page=1`;
    
    console.log(`Fetching TMDB reviews: ${url}`);
    const data = await fetchWithTimeout(url);
    
    if (!data?.results) return [];
    
    return data.results.slice(0, 4).map(review => ({
      text: review.content.slice(0, 400), // Limita tamanho
      author: review.author || 'Usuário TMDB',
      score: Math.round((review.author_details?.rating || 7) * 10), // Converte para 0-100
      link: review.url || `https://www.themoviedb.org/${endpoint}/${tmdbId}/reviews`,
      source: 'TMDB',
      date: review.created_at?.slice(0, 10) || null
    }));
    
  } catch (error) {
    console.warn('TMDB reviews failed:', error.message);
    return [];
  }
}

// Busca dados do OMDb (tem ratings agregados)
async function getOMDbData(title, year, type = 'movie') {
  if (!title) return null;
  
  try {
    const typeParam = type === 'tv' ? 'series' : 'movie';
    const url = `${OMDB_BASE_URL}/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}&y=${year}&type=${typeParam}`;
    
    console.log(`Fetching OMDb data: ${url}`);
    const data = await fetchWithTimeout(url);
    
    if (data?.Response === 'False') return null;
    
    // OMDb tem ratings do IMDb, Rotten Tomatoes e Metacritic
    const ratings = data.Ratings || [];
    const reviews = [];
    
    // Cria "reviews" baseados nos ratings agregados
    ratings.forEach(rating => {
      let reviewText = '';
      let author = '';
      let score = 0;
      
      if (rating.Source === 'Internet Movie Database') {
        const imdbScore = parseFloat(rating.Value.split('/')[0]) * 10;
        score = Math.round(imdbScore);
        author = 'Média IMDb';
        reviewText = `Avaliação geral dos usuários do IMDb: ${rating.Value}. ${data.Plot || ''}`.slice(0, 300);
      } else if (rating.Source === 'Rotten Tomatoes') {
        score = parseInt(rating.Value.replace('%', ''));
        author = 'Rotten Tomatoes';
        reviewText = `Consenso crítico: ${score}% dos críticos recomendaram. ${data.Plot || ''}`.slice(0, 300);
      } else if (rating.Source === 'Metacritic') {
        score = parseInt(rating.Value.split('/')[0]);
        author = 'Metacritic';
        reviewText = `Pontuação Metacritic: ${rating.Value}. Baseado em reviews profissionais.`.slice(0, 300);
      }
      
      if (reviewText) {
        reviews.push({
          text: reviewText,
          author,
          score,
          link: `https://www.imdb.com/title/${data.imdbID}/`,
          source: 'OMDb',
          date: data.Year
        });
      }
    });
    
    return reviews;
    
  } catch (error) {
    console.warn('OMDb failed:', error.message);
    return [];
  }
}

// Gera reviews sintéticos de qualidade baseados no conteúdo real
function generateContextualReviews(contentData) {
  const { title, year, rating, genres = [], type } = contentData;
  const isTV = type === 'tv';
  
  // Base para reviews mais inteligentes
  const templates = {
    high_rating: [
      `${title} superou minhas expectativas. ${isTV ? 'Cada episódio' : 'O filme'} mantém um ritmo envolvente do início ao fim.`,
      `Finalmente um ${isTV ? 'série' : 'filme'} de ${genres[0] || 'qualidade'} que vale a pena. ${title} entrega tudo que promete.`,
      `${title} é um daqueles ${isTV ? 'shows' : 'filmes'} que você maratona sem perceber o tempo passar. Recomendo!`
    ],
    medium_rating: [
      `${title} é decente, mas sinto que poderia ter explorado melhor alguns elementos. ${isTV ? 'Algumas temporadas' : 'Certas partes'} são melhores que outras.`,
      `Assisti ${title} com expectativas moderadas e saí satisfeito. Não é revolucionário, mas cumpre o que promete.`,
      `${title} tem seus momentos brilhantes intercalados com alguns tropeços. No geral, vale a experiência.`
    ],
    low_rating: [
      `Que decepção foi ${title}. Tinha tudo para dar certo, mas ${isTV ? 'a série' : 'o filme'} não conseguiu desenvolver seu potencial.`,
      `${title} começa bem mas vai perdendo força. ${isTV ? 'As últimas temporadas' : 'O terceiro ato'} deixam muito a desejar.`,
      `Terminei ${title} mais por teimosia que por prazer. Há ${isTV ? 'séries' : 'filmes'} muito melhores para gastar tempo.`
    ]
  };
  
  // Seleciona template baseado no rating
  let category = 'medium_rating';
  if (rating >= 8) category = 'high_rating';
  else if (rating <= 5) category = 'low_rating';
  
  const selectedTemplates = templates[category];
  
  return selectedTemplates.slice(0, 2).map((text, index) => ({
    text,
    author: ['CríticoAssíduo', 'EspectadorCurioso', 'FãDeQualidade'][index] || 'ReviewerAnônimo',
    score: Math.round(rating * 10 + (Math.random() - 0.5) * 20), // Varia em torno do rating
    link: `https://letterboxd.com/search/${encodeURIComponent(title)}/`,
    source: 'Sintético',
    date: year
  }));
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { title = "", year = "", type = "movie", tmdb_id = "", imdb_id = "" } = req.query || {};
    
    if (!title && !tmdb_id) {
      res.status(200).json({ 
        reviews: [], 
        error: "Título ou TMDB ID necessário",
        sources: []
      });
      return;
    }

    console.log(`Searching reviews for: ${title} (${year}) - Type: ${type}`);
    
    let allReviews = [];
    const sources = [];

    // 1. TMDB Reviews (fonte primária para ambos)
    if (tmdb_id) {
      const tmdbReviews = await getTMDBReviews(tmdb_id, type);
      if (tmdbReviews.length > 0) {
        allReviews.push(...tmdbReviews);
        sources.push(`TMDB (${tmdbReviews.length} reviews)`);
        console.log(`Found ${tmdbReviews.length} TMDB reviews`);
      }
    }

    // 2. OMDb Reviews (ratings agregados)
    if (title) {
      const omdbReviews = await getOMDbData(title, year, type);
      if (omdbReviews && omdbReviews.length > 0) {
        allReviews.push(...omdbReviews);
        sources.push(`OMDb (${omdbReviews.length} ratings)`);
        console.log(`Found ${omdbReviews.length} OMDb ratings`);
      }
    }

    // 3. Se ainda não temos reviews suficientes, gera contextuais
    if (allReviews.length < 2) {
      const rating = parseFloat(req.query.rating) || 7.0;
      const contextualReviews = generateContextualReviews({
        title,
        year,
        rating,
        genres: req.query.genres ? req.query.genres.split(',') : [],
        type
      });
      
      allReviews.push(...contextualReviews);
      sources.push(`Contextuais (${contextualReviews.length})`);
      console.log(`Generated ${contextualReviews.length} contextual reviews`);
    }

    // Remove duplicados e ordena por score
    const seen = new Set();
    const uniqueReviews = allReviews
      .filter(review => {
        const key = `${review.author}-${review.text.slice(0, 50)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 6);

    const response = {
      reviews: uniqueReviews,
      sources,
      debug: {
        totalFound: allReviews.length,
        uniqueReviews: uniqueReviews.length,
        sources: sources,
        query: { title, year, type, tmdb_id }
      }
    };

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=600");
    res.status(200).json(response);
    
  } catch (error) {
    console.error("Reviews API error:", error);
    res.status(200).json({ 
      reviews: [], 
      error: "Serviço temporariamente indisponível",
      sources: []
    });
  }
}