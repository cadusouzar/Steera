// Fórmula de Haversine — distância em linha reta (metros) entre dois pontos lat/lng, usada pra
// decidir se uma batida aconteceu dentro do raio configurado de algum WorkLocation. Sempre
// calculada no servidor (nunca confiamos numa flag "dentro do raio" vinda do cliente).
export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
