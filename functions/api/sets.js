// Pokemon TCG sets — server-side proxy (실 발매 데이터)
export async function onRequest(context) {
  try {
    const res = await fetch(
      'https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=80',
      { headers: { 'User-Agent': 'cardpick/1.0' } }
    );
    if (!res.ok) return json({ error: `sets ${res.status}` }, 500);
    const body = await res.json();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');

    const sets = (body.data || []).map(s => ({
      id: s.id,
      name: s.name,
      series: s.series,
      release_date: (s.releaseDate || '').replace(/\//g, '-'),  // YYYY-MM-DD
      printed_total: s.printedTotal,
      total: s.total,
      symbol_url: s.images && s.images.symbol,
      ptcgo_code: s.ptcgoCode,
      is_upcoming: s.releaseDate && s.releaseDate > today
    }));

    const upcoming = sets.filter(s => s.is_upcoming).sort((a,b) => a.release_date.localeCompare(b.release_date));
    const recent = sets.filter(s => !s.is_upcoming).slice(0, 12);
    const archive = sets.filter(s => !s.is_upcoming).slice(12, 60);

    return json({
      today: today.replace(/\//g, '-'),
      upcoming, recent, archive,
      total: sets.length
    });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=21600',  // 1h browser, 6h edge
      'Access-Control-Allow-Origin': '*'
    }
  });
}
