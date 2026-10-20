// Weather from Open-Meteo: free, no key, no account. Location is a city you pick in
// settings (looked up with Open-Meteo's geocoder), so Atoll never asks for GPS.
import { get, set } from './prefs.js';
import { native } from './api.js';

const CACHE = 'atoll:weather';
const MAX_AGE = 30 * 60 * 1000;
let current = readCache();
const listeners = new Set();

const CODES = [
  [[0], 'Clear', 'sun'], [[1], 'Mostly clear', 'sun'], [[2], 'Partly cloudy', 'partly'], [[3], 'Overcast', 'cloud'],
  [[45, 48], 'Fog', 'fog'], [[51, 53, 55, 56, 57], 'Drizzle', 'rain'], [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow', 'snow'], [[95, 96, 99], 'Storm', 'storm'],
];
export function describe(code) {
  const hit = CODES.find(([codes]) => codes.includes(code));
  return hit ? { label: hit[1], kind: hit[2] } : { label: 'Weather', kind: 'cloud' };
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE));
  } catch {
    return null;
  }
}

export const weather = () => current;
export function onWeather(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const DEMO = { city: 'Lisbon', temp: 21, code: 1, days: [[23, 15, 1], [22, 14, 2], [19, 14, 61], [20, 13, 3], [24, 15, 0], [25, 16, 0], [22, 15, 2]] };

export async function refresh(force = false) {
  const { city, units } = get();
  if (!native && !city) {
    current = { ...DEMO, at: Date.now(), units };
    listeners.forEach((fn) => fn(current));
    return current;
  }
  if (!city) return null;
  if (!force && current && current.city === city.name && current.units === units && Date.now() - current.at < MAX_AGE) return current;
  const q = new URLSearchParams({
    latitude: city.lat, longitude: city.lon, current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto', forecast_days: 7, temperature_unit: units === 'f' ? 'fahrenheit' : 'celsius',
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    const data = await res.json();
    current = {
      city: city.name, units, at: Date.now(),
      temp: Math.round(data.current.temperature_2m), code: data.current.weather_code,
      days: data.daily.time.map((_, i) => [Math.round(data.daily.temperature_2m_max[i]), Math.round(data.daily.temperature_2m_min[i]), data.daily.weather_code[i]]),
    };
    localStorage.setItem(CACHE, JSON.stringify(current));
    listeners.forEach((fn) => fn(current));
  } catch {
    // Offline: keep showing the last forecast.
  }
  return current;
}

export async function searchCity(name) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: 5, format: 'json' })}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({ name: r.name, detail: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
}

export function setCity(city) {
  set({ city });
  current = null;
  return refresh(true);
}

setInterval(() => refresh(), MAX_AGE);
