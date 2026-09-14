import { haversineDistanceMeters } from './geo-distance.util';

describe('haversineDistanceMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistanceMeters(-23.55052, -46.633308, -23.55052, -46.633308)).toBe(0);
  });

  it('computes a known distance between two real points in the same city (Av. Paulista to Praça da Sé, São Paulo, ~4km)', () => {
    // Av. Paulista, MASP: -23.561414, -46.655881
    // Praça da Sé: -23.550190, -46.633720
    const distance = haversineDistanceMeters(-23.561414, -46.655881, -23.55019, -46.63372);
    // Real-world straight-line distance is ~2.7km; assert within a generous tolerance band to
    // avoid flakiness from rounding, while still catching a badly broken formula.
    expect(distance).toBeGreaterThan(2000);
    expect(distance).toBeLessThan(4000);
  });

  it('computes a known short distance (~111km) between two points exactly 1 degree of latitude apart at the equator', () => {
    const distance = haversineDistanceMeters(0, 0, 1, 0);
    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('is symmetric (distance A->B equals distance B->A)', () => {
    const ab = haversineDistanceMeters(-23.55052, -46.633308, -22.906847, -43.172897);
    const ba = haversineDistanceMeters(-22.906847, -43.172897, -23.55052, -46.633308);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('computes the approximate distance between São Paulo and Rio de Janeiro (~360km)', () => {
    const distance = haversineDistanceMeters(-23.55052, -46.633308, -22.906847, -43.172897);
    expect(distance).toBeGreaterThan(340_000);
    expect(distance).toBeLessThan(380_000);
  });
});
