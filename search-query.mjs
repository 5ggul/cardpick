// Shared by the classic header search (lazy import) and /search SSR.
// This is a search alias list, not a complete Korean card-name database.
// 2026-10-07 corrections/addition: Phanpy=코코리, Espeon=에브이,
// Venonat=콘팡. Official multilingual rows: Pokémon WC12 Battle Dictionary,
// printed pp. 21, 20, 16; Eevee=이브이 is on p.18.
// https://assets.pokemon.com/assets/cms/pdf/op/tcg_champ_series/2011-2012/WC12_Battle_Dictionary.pdf
const KOREAN_ALIASES = Object.freeze({
  '리자몽':'charizard', '거북왕':'blastoise', '이상해꽃':'venusaur',
  '파이리':'charmander', '꼬부기':'squirtle', '이상해씨':'bulbasaur',
  '리자드':'charmeleon', '어니부기':'wartortle', '이상해풀':'ivysaur',
  '피카츄':'pikachu', '라이츄':'raichu', '뮤':'mew', '뮤츠':'mewtwo',
  '잠만보':'snorlax', '망나뇽':'dragonite', '미뇽':'dratini', '신뇽':'dragonair',
  '갸라도스':'gyarados', '잉어킹':'magikarp', '식스테일':'vulpix', '나인테일':'ninetales',
  '아보크':'arbok', '모래두지':'sandshrew', '고지':'sandslash',
  '나옹':'meowth', '페르시온':'persian', '독침붕':'beedrill', '버터플':'butterfree',
  '꼬렛':'rattata', '레트라':'raticate', '깨비참':'spearow', '깨비드릴조':'fearow',
  '아보':'ekans', '뚜벅쵸':'oddish', '냄새꼬':'gloom', '라플레시아':'vileplume',
  '파라스':'paras', '파라섹트':'parasect', '콘팡':'venonat', '도나리':'venomoth',
  '디그다':'diglett', '닥트리오':'dugtrio',
  '고라파덕':'psyduck', '골덕':'golduck', '망키':'mankey', '성원숭':'primeape',
  '가디':'growlithe', '윈디':'arcanine', '발챙이':'poliwag', '슈륙챙이':'poliwhirl',
  '강챙이':'poliwrath', '캐이시':'abra', '윤겔라':'kadabra', '후딘':'alakazam',
  '알통몬':'machop', '근육몬':'machoke', '괴력몬':'machamp',
  '모다피':'bellsprout', '우츠동':'weepinbell', '우츠보트':'victreebel',
  '왕눈해':'tentacool', '독파리':'tentacruel', '꼬마돌':'geodude',
  '데구리':'graveler', '딱구리':'golem', '포니타':'ponyta', '날쌩마':'rapidash',
  '야돈':'slowpoke', '야도란':'slowbro', '코일':'magnemite', '레어코일':'magneton',
  '파오리':'farfetchd', '두두':'doduo', '두트리오':'dodrio',
  '쥬쥬':'seel', '쥬레곤':'dewgong', '질퍽이':'grimer', '질뻐기':'muk',
  '셀러':'shellder', '파르셀':'cloyster', '고오스':'gastly', '고우스트':'haunter', '팬텀':'gengar',
  '롱스톤':'onix', '슬리프':'drowzee', '슬리퍼':'hypno', '크랩':'krabby', '킹크랩':'kingler',
  '찌리리공':'voltorb', '붐볼':'electrode', '아라리':'exeggcute', '나시':'exeggutor',
  '탕구리':'cubone', '텅구리':'marowak', '시라소몬':'hitmonlee', '홍수몬':'hitmonchan',
  '내루미':'lickitung', '또가스':'koffing', '또도가스':'weezing',
  '뿔카노':'rhyhorn', '코뿌리':'rhydon', '럭키':'chansey', '덩쿠리':'tangela',
  '캥카':'kangaskhan', '쏘드라':'horsea', '시드라':'seadra', '콘치':'goldeen', '왕콘치':'seaking',
  '별가사리':'staryu', '아쿠스타':'starmie', '마임맨':'mr-mime', '스라크':'scyther',
  '루주라':'jynx', '에레브':'electabuzz', '마그마':'magmar', '쁘사이저':'pinsir',
  '켄타로스':'tauros', '메타몽':'ditto', '이브이':'eevee',
  '샤미드':'vaporeon', '쥬피썬더':'jolteon', '부스터':'flareon',
  '폴리곤':'porygon', '암나이트':'omanyte', '암스타':'omastar',
  '투구':'kabuto', '투구푸스':'kabutops', '프테라':'aerodactyl',
  '프리져':'articuno', '썬더':'zapdos', '파이어':'moltres', '루기아':'lugia', '칠색조':'ho-oh',
  '에브이':'espeon', '님피아':'sylveon', '리피아':'leafeon', '글레이시아':'glaceon',
  '블래키':'umbreon', '에피':'espeon',
  '메가리자몽':'mega charizard', '메가팬텀':'mega gengar',
  '메가입치트':'mega mawile', '메가갸라도스':'mega gyarados',
  '제라오라':'zeraora', '코라이돈':'koraidon', '미라이돈':'miraidon',
  '루카리오':'lucario', '리오르':'riolu', '코코리':'phanpy',
  '캐터피':'caterpie', '단데기':'metapod', '뿔충이':'weedle', '딱충이':'kakuna',
  '구구':'pidgey', '피죤':'pidgeotto', '피죤투':'pidgeot'
});
const aliasPattern = new RegExp('(^|[^가-힣])(' + Object.keys(KOREAN_ALIASES)
  .sort((a, b) => b.length - a.length).join('|') + ')(?=$|[^가-힣])', 'g');

export function normalizeSearchQuery(value) {
  const original = String(value ?? '').normalize('NFC').trim().slice(0, 80);
  // Asterisks are separators, never caller-controlled PostgREST wildcards.
  // Keep unrecognized Korean words intact rather than guessing a translation.
  const normalized = original.replace(aliasPattern, (_, prefix, name) => prefix + ' ' + KOREAN_ALIASES[name] + ' ')
    .replace(/\*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return { original, normalized, tokens: normalized.split(/\s+/).filter(Boolean).slice(0, 5) };
}

export function escapeSearchToken(token) {
  return String(token).replace(/\*/g, ' ').replace(/[\\%_]/g, '\\$&');
}

export function getTrustedSearchPrice(trust) {
  if (!trust || !['HIGH', 'MEDIUM', 'LOW'].includes(trust.trust_level)) return null;
  if (typeof trust.display_krw !== 'number' && typeof trust.display_krw !== 'string') return null;
  const price = Number(trust.display_krw);
  return Number.isFinite(price) && price > 0 && Math.round(price) > 0 ? Math.round(price) : null;
}

export function sortSearchCards(cards, normalized) {
  const q = normalized.toLowerCase();
  return cards.slice().sort((a, b) => {
    const aNames = [a.name || '', a.name_en || '', a.name_ko || ''].filter(Boolean).map(n => n.toLowerCase());
    const bNames = [b.name || '', b.name_en || '', b.name_ko || ''].filter(Boolean).map(n => n.toLowerCase());
    const aExact = aNames.includes(q), bExact = bNames.includes(q);
    if (aExact !== bExact) return aExact ? -1 : 1;
    const aStarts = aNames.some(n => n.startsWith(q)), bStarts = bNames.some(n => n.startsWith(q));
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    const aLen = Math.min(...aNames.map(n => n.length), 999);
    const bLen = Math.min(...bNames.map(n => n.length), 999);
    return aLen - bLen || (a.popularity_rank || 9999) - (b.popularity_rank || 9999);
  });
}
