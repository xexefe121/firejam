import type { Place } from '../../shared/protocol.ts';

// Cities people can pick as "home". Coordinates place them on the Jam Map,
// the time zone lets everyone in a jam see each other's local time.
export const PLACES: Place[] = [
  { id: 'sydney', city: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' },
  { id: 'melbourne', city: 'Melbourne', country: 'Australia', lat: -37.81, lon: 144.96, tz: 'Australia/Melbourne' },
  { id: 'auckland', city: 'Auckland', country: 'New Zealand', lat: -36.85, lon: 174.76, tz: 'Pacific/Auckland' },
  { id: 'hyderabad', city: 'Hyderabad', country: 'India', lat: 17.39, lon: 78.49, tz: 'Asia/Kolkata' },
  { id: 'chennai', city: 'Chennai', country: 'India', lat: 13.08, lon: 80.27, tz: 'Asia/Kolkata' },
  { id: 'bengaluru', city: 'Bengaluru', country: 'India', lat: 12.97, lon: 77.59, tz: 'Asia/Kolkata' },
  { id: 'kochi', city: 'Kochi', country: 'India', lat: 9.93, lon: 76.27, tz: 'Asia/Kolkata' },
  { id: 'mumbai', city: 'Mumbai', country: 'India', lat: 19.08, lon: 72.88, tz: 'Asia/Kolkata' },
  { id: 'delhi', city: 'Delhi', country: 'India', lat: 28.61, lon: 77.21, tz: 'Asia/Kolkata' },
  { id: 'kolkata', city: 'Kolkata', country: 'India', lat: 22.57, lon: 88.36, tz: 'Asia/Kolkata' },
  { id: 'dhaka', city: 'Dhaka', country: 'Bangladesh', lat: 23.81, lon: 90.41, tz: 'Asia/Dhaka' },
  { id: 'karachi', city: 'Karachi', country: 'Pakistan', lat: 24.86, lon: 67.01, tz: 'Asia/Karachi' },
  { id: 'singapore', city: 'Singapore', country: 'Singapore', lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' },
  { id: 'manila', city: 'Manila', country: 'Philippines', lat: 14.6, lon: 120.98, tz: 'Asia/Manila' },
  { id: 'tokyo', city: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69, tz: 'Asia/Tokyo' },
  { id: 'seoul', city: 'Seoul', country: 'South Korea', lat: 37.57, lon: 126.98, tz: 'Asia/Seoul' },
  { id: 'dubai', city: 'Dubai', country: 'UAE', lat: 25.2, lon: 55.27, tz: 'Asia/Dubai' },
  { id: 'cairo', city: 'Cairo', country: 'Egypt', lat: 30.04, lon: 31.24, tz: 'Africa/Cairo' },
  { id: 'nairobi', city: 'Nairobi', country: 'Kenya', lat: -1.29, lon: 36.82, tz: 'Africa/Nairobi' },
  { id: 'accra', city: 'Accra', country: 'Ghana', lat: 5.6, lon: -0.19, tz: 'Africa/Accra' },
  { id: 'lagos', city: 'Lagos', country: 'Nigeria', lat: 6.52, lon: 3.38, tz: 'Africa/Lagos' },
  { id: 'london', city: 'London', country: 'UK', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
  { id: 'berlin', city: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.4, tz: 'Europe/Berlin' },
  { id: 'oslo', city: 'Oslo', country: 'Norway', lat: 59.91, lon: 10.75, tz: 'Europe/Oslo' },
  { id: 'madrid', city: 'Madrid', country: 'Spain', lat: 40.42, lon: -3.7, tz: 'Europe/Madrid' },
  { id: 'toronto', city: 'Toronto', country: 'Canada', lat: 43.65, lon: -79.38, tz: 'America/Toronto' },
  { id: 'newyork', city: 'New York', country: 'USA', lat: 40.71, lon: -74.01, tz: 'America/New_York' },
  { id: 'seattle', city: 'Seattle', country: 'USA', lat: 47.61, lon: -122.33, tz: 'America/Los_Angeles' },
  { id: 'mexicocity', city: 'Mexico City', country: 'Mexico', lat: 19.43, lon: -99.13, tz: 'America/Mexico_City' },
  { id: 'saopaulo', city: 'São Paulo', country: 'Brazil', lat: -23.55, lon: -46.63, tz: 'America/Sao_Paulo' },
];

export const placeById = (id: string): Place => PLACES.find((p) => p.id === id) ?? PLACES[0];

/** The city for a device's time zone: exact match, else the first city in the same region. */
export function placeForTz(tz: string | undefined): Place {
  if (!tz) return PLACES[0];
  return PLACES.find((p) => p.tz === tz) ?? PLACES.find((p) => p.tz.split('/')[0] === tz.split('/')[0]) ?? PLACES[0];
}
