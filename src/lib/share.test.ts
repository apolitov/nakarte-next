import { describe, expect, it } from 'vitest';
import { encodePolyline, decodePolyline, routeToParam, paramToRoute } from './share';

describe('route link', () => {
  it('matches the reference polyline from Google docs', () => {
    const pts = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
  });
  it('round-trips a route with straight legs and params', () => {
    const doc = {
      profile: 'gravel',
      waypoints: [{ lng: -9.4, lat: 38.79 }, { lng: -9.38, lat: 38.8, straight: true }, { lng: -9.37, lat: 38.81 }],
      params: { uphillcost: 80, uphillcutoff: 6 },
    };
    const v = routeToParam(doc);
    const back = paramToRoute(v)!;
    expect(back.profile).toBe('gravel');
    expect(back.waypoints[1].straight).toBe(true);
    expect(back.waypoints[0].straight).toBeUndefined();
    expect(back.params).toEqual({ uphillcost: 80, uphillcutoff: 6 });
    // survives the URL hash
    const hash = '#m=13/1/2&l=O&r=' + encodeURIComponent(v);
    expect(new URLSearchParams(hash.slice(1)).get('r')).toBe(v);
  });
  it('is short: 50 points under 400 chars', () => {
    const wps = Array.from({ length: 50 }, (_, i) => ({ lng: -9.4 + i * 0.013, lat: 38.7 + Math.sin(i) * 0.02 }));
    expect(encodeURIComponent(routeToParam({ profile: 'trekking', waypoints: wps })).length).toBeLessThan(400);
  });
  it('rejects garbage', () => {
    expect(paramToRoute('trekking!\u0001')).toBeNull();
  });
});
