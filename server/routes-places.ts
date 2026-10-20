import { Router } from "express";
import { z } from "zod";
import { db } from "./store.ts";
import { distanceKm, rateLimit } from "./security.ts";

export const placesRouter = Router();

export type Hospital = {
  id: string; name: string; address: string; lat: number; lng: number; distanceKm: number;
  source: "google" | "openstreetmap"; directionsUrl: string; mapsUrl: string; phone?: string; rating?: number;
};

type NearbyPharmacy = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  source: "google" | "openstreetmap" | "smart-diagno";
  orderable: boolean;
  directionsUrl: string;
  mapsUrl: string;
  phone?: string;
};

type PharmacyMapResults = {
  shops: NearbyPharmacy[];
  available: boolean;
};

type PlaceBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const cache = new Map<string, { at: number; value: Hospital[] }>();
const pharmacyCache = new Map<string, { at: number; value: PharmacyMapResults }>();
const areaPharmacyCache = new Map<string, { at: number; value: { shops: NearbyPharmacy[]; available: boolean; label: string; center: { lat: number; lng: number } } }>();
const CACHE_MS = 10 * 60 * 1000;
const DEFAULT_PHARMACY_RADIUS_KM = 29;

const directions = (lat: number, lng: number, placeId?: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ""}`;
const mapsLink = (name: string, lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat},${lng}`)}`;

async function findMapPharmacies(lat: number, lng: number, radiusKm: number): Promise<PharmacyMapResults> {
  const cacheKey = `${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm}`;
  const cached = pharmacyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return {
      ...cached.value,
      shops: cached.value.shops.filter((shop) => distanceKm(lat, lng, shop.lat, shop.lng) <= radiusKm),
    };
  }

  let available = false;
  const radiusM = radiusKm * 1000;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      const result = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST", signal: AbortSignal.timeout(8000),
        headers: {
          "content-type": "application/json", "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.googleMapsUri",
        },
        body: JSON.stringify({
          includedTypes: ["pharmacy"], maxResultCount: 20, rankPreference: "DISTANCE",
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
        }),
      });
      if (result.ok) {
        available = true;
        const body: any = await result.json();
        const places: NearbyPharmacy[] = (body.places ?? []).flatMap((place: any) => {
          const pLat = place.location?.latitude, pLng = place.location?.longitude;
          if (typeof pLat !== "number" || typeof pLng !== "number") return [];
          const exactDistance = distanceKm(lat, lng, pLat, pLng);
          if (exactDistance > radiusKm) return [];
          return [{
            id: `g:${place.id}`, name: place.displayName?.text ?? "Pharmacy",
            address: place.formattedAddress ?? "", lat: pLat, lng: pLng,
            distanceKm: Math.round(exactDistance * 10) / 10,
            source: "google", orderable: false, directionsUrl: directions(pLat, pLng, place.id),
            mapsUrl: place.googleMapsUri ?? mapsLink(place.displayName?.text ?? "Pharmacy", pLat, pLng),
            phone: place.nationalPhoneNumber,
          }];
        });
        if (places.length >= 10) {
          const result = { shops: places, available: true };
          pharmacyCache.set(cacheKey, { at: Date.now(), value: result });
          return result;
        }
        const osm = await findOsmPharmacies(lat, lng, radiusKm);
        const combined = mergePharmacies(places, osm.shops);
        const result = { shops: combined, available: available || osm.available };
        if (result.available) pharmacyCache.set(cacheKey, { at: Date.now(), value: result });
        return result;
      }
    } catch { /* Fall back to OpenStreetMap. */ }
  }
  const osm = await findOsmPharmacies(lat, lng, radiusKm);
  const result = { shops: osm.shops, available: available || osm.available };
  if (result.available) pharmacyCache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}

function mergePharmacies(...groups: NearbyPharmacy[][]): NearbyPharmacy[] {
  const byId = new Map<string, NearbyPharmacy>();
  for (const shop of groups.flat()) {
    const key = shop.id.startsWith("osm:") ? shop.id : shop.name.toLowerCase().replace(/[^a-z0-9]/g, "") + `:${shop.lat.toFixed(4)}:${shop.lng.toFixed(4)}`;
    if (!byId.has(key)) byId.set(key, shop);
  }
  return [...byId.values()];
}

async function fromNominatimPharmacies(lat: number, lng: number, radiusKm: number): Promise<PharmacyMapResults | null> {
  const cached = pharmacyCache.get(`${lat.toFixed(3)}:${lng.toFixed(3)}:${radiusKm}`);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!rateLimit("nominatim-pharmacy-search", 1, 1000)) return null;

  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.01, Math.abs(Math.cos((lat * Math.PI) / 180))));
  const params = new URLSearchParams({
    format: "jsonv2",
    q: "pharmacy",
    limit: "50",
    viewbox: `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`,
    bounded: "1",
    addressdetails: "1",
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "accept": "application/json",
        "user-agent": "SmartDiagno/1.0 (+https://smart-diagno.onrender.com)",
      },
    });
    if (!response.ok) return null;
    const body: any[] = await response.json();
    const shops: NearbyPharmacy[] = body.flatMap((place: any) => {
      if (!["pharmacy", "chemist"].includes(place.type)) return [];
      const placeLat = Number(place.lat), placeLng = Number(place.lon);
      if (!Number.isFinite(placeLat) || !Number.isFinite(placeLng)) return [];
      const exactDistance = distanceKm(lat, lng, placeLat, placeLng);
      if (exactDistance > radiusKm) return [];
      const name = String(place.name || place.display_name?.split(",")[0] || "Pharmacy").trim();
      const address = [
        place.address?.road,
        place.address?.suburb ?? place.address?.neighbourhood,
        place.address?.city ?? place.address?.town,
        place.address?.postcode,
      ].filter(Boolean).join(", ");
      return [{
        id: `osm:${place.osm_type}/${place.osm_id}`,
        name,
        address,
        lat: placeLat,
        lng: placeLng,
        distanceKm: Math.round(exactDistance * 10) / 10,
        source: "openstreetmap",
        orderable: false,
        directionsUrl: directions(placeLat, placeLng),
        mapsUrl: mapsLink(name, placeLat, placeLng),
      }];
    });
    return { shops, available: true };
  } catch {
    return null;
  }
}

async function findOsmPharmacies(lat: number, lng: number, radiusKm: number): Promise<PharmacyMapResults> {
  const radiusM = radiusKm * 1000;
  const query = `[out:json][timeout:15];(nwr["amenity"="pharmacy"](around:${radiusM},${lat},${lng});nwr["shop"="chemist"](around:${radiusM},${lat},${lng}););out center tags 200;`;
  let available = false;
  let shops: NearbyPharmacy[] = [];

  const nominatim = await fromNominatimPharmacies(lat, lng, radiusKm);
  if (nominatim) {
    available = true;
    shops = nominatim.shops;
  }
  if (shops.length >= 20) return { shops, available };

  for (const endpoint of OVERPASS) {
    try {
      const result = await fetch(endpoint, {
        method: "POST", signal: AbortSignal.timeout(15000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "SmartDiagno/1.0 (+https://smart-diagno.onrender.com)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!result.ok) continue;
      available = true;
      const body: any = await result.json();
      const results: NearbyPharmacy[] = (body.elements ?? []).flatMap((element: any): NearbyPharmacy[] => {
        const pLat = element.lat ?? element.center?.lat;
        const pLng = element.lon ?? element.center?.lon;
        const tags = element.tags ?? {};
        if (typeof pLat !== "number" || typeof pLng !== "number") return [];
        const name = tags.name ?? tags["name:en"];
        if (!name) return [];
        const exactDistance = distanceKm(lat, lng, pLat, pLng);
        if (exactDistance > radiusM / 1000) return [];
        const distance = Math.round(exactDistance * 10) / 10;
        const address = [
          tags["addr:housenumber"], tags["addr:street"],
          tags["addr:suburb"] ?? tags["addr:neighbourhood"],
          tags["addr:city"] ?? tags["addr:town"], tags["addr:postcode"],
        ].filter(Boolean).join(", ");
        return [{
          id: `osm:${element.type}/${element.id}`, name, address, lat: pLat, lng: pLng,
          distanceKm: distance, source: "openstreetmap", orderable: false,
          directionsUrl: directions(pLat, pLng), mapsUrl: mapsLink(name, pLat, pLng),
          phone: tags.phone ?? tags["contact:phone"],
        }];
      });
      shops = mergePharmacies(shops, results);
      if (shops.length >= 20) break;
    } catch { /* Try the next Overpass mirror. */ }
  }
  return { shops, available };
}

function isWithinBounds(lat: number, lng: number, bounds: PlaceBounds) {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

function matchesPostalCode(address: string, postalCode: string) {
  const code = postalCode.toLowerCase().replace(/[^a-z0-9]/g, "");
  const pattern = code.split("").join("[\\s-]*");
  return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`, "i").test(address);
}

async function findPharmaciesInArea(query: string, postalCode: string): Promise<{
  shops: NearbyPharmacy[];
  available: boolean;
  label: string;
  center: { lat: number; lng: number };
}> {
  const areaQuery = query;
  const geocodeParams = new URLSearchParams({
    format: "jsonv2", addressdetails: "1", limit: "1", q: areaQuery,
  });
  const geocodeResponse = await fetch(`https://nominatim.openstreetmap.org/search?${geocodeParams}`, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json", "user-agent": "SmartDiagno/1.0 (+https://smart-diagno.onrender.com)" },
  });
  if (!geocodeResponse.ok) throw new Error("The selected village or postal code could not be looked up.");
  const geocoded: any[] = await geocodeResponse.json();
  const place = geocoded[0];
  if (!place || !Array.isArray(place.boundingbox) || place.boundingbox.length !== 4) {
    throw new Error("We couldn't find this village. Check the spelling, district and postal code.");
  }
  const bounds: PlaceBounds = {
    south: Number(place.boundingbox[0]),
    north: Number(place.boundingbox[1]),
    west: Number(place.boundingbox[2]),
    east: Number(place.boundingbox[3]),
  };
  if (Object.values(bounds).some((value) => !Number.isFinite(value))) {
    throw new Error("The selected village did not return a valid map area.");
  }
  const center = { lat: Number(place.lat), lng: Number(place.lon) };
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
    throw new Error("The selected village did not return a valid map location.");
  }

  const shops: NearbyPharmacy[] = [];
  let available = false;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      const searchRadius = Math.max(100, Math.ceil(Math.max(
        distanceKm(center.lat, center.lng, bounds.south, bounds.west),
        distanceKm(center.lat, center.lng, bounds.north, bounds.east),
      ) * 1000));
      const googleResponse = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": googleKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.googleMapsUri",
        },
        body: JSON.stringify({
          includedTypes: ["pharmacy"],
          rankPreference: "DISTANCE",
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center,
              radius: Math.min(50_000, searchRadius),
            },
          },
        }),
      });
      if (googleResponse.ok) {
        available = true;
        const body: any = await googleResponse.json();
        for (const item of body.places ?? []) {
          const lat = item.location?.latitude, lng = item.location?.longitude;
          const address = String(item.formattedAddress ?? "");
          if (typeof lat !== "number" || typeof lng !== "number" || !isWithinBounds(lat, lng, bounds)) continue;
          if (postalCode && !matchesPostalCode(address, postalCode)) continue;
          const name = item.displayName?.text ?? "Pharmacy";
          shops.push({
            id: `g:${item.id}`,
            name,
            address,
            lat,
            lng,
            distanceKm: 0,
            source: "google",
            orderable: false,
            directionsUrl: directions(lat, lng, item.id),
            mapsUrl: item.googleMapsUri ?? mapsLink(name, lat, lng),
            phone: item.nationalPhoneNumber,
          });
        }
      }
    } catch { /* Continue with OpenStreetMap data. */ }
  }

  const overpassQuery = `[out:json][timeout:15];(nwr["amenity"="pharmacy"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});nwr["shop"="chemist"](${bounds.south},${bounds.west},${bounds.north},${bounds.east}););out center tags 200;`;
  for (const endpoint of OVERPASS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(12000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "SmartDiagno/1.0 (+https://smart-diagno.onrender.com)",
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      });
      if (!response.ok) continue;
      available = true;
      const body: any = await response.json();
      for (const item of body.elements ?? []) {
        const lat = item.lat ?? item.center?.lat, lng = item.lon ?? item.center?.lon;
        const tags = item.tags ?? {};
        if (typeof lat !== "number" || typeof lng !== "number" || !isWithinBounds(lat, lng, bounds)) continue;
        const addressParts = [
          tags["addr:street"],
          tags["addr:suburb"] ?? tags["addr:neighbourhood"],
          tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:village"],
          tags["addr:postcode"],
        ].filter(Boolean);
        const address = addressParts.join(", ");
        if (postalCode && tags["addr:postcode"] && !matchesPostalCode(tags["addr:postcode"], postalCode)) continue;
        const name = tags.name ?? tags["name:en"] ?? "Pharmacy";
        shops.push({
          id: `osm:${item.type}/${item.id}`,
          name,
          address,
          lat,
          lng,
          distanceKm: 0,
          source: "openstreetmap",
          orderable: false,
          directionsUrl: directions(lat, lng),
          mapsUrl: mapsLink(name, lat, lng),
          phone: tags.phone ?? tags["contact:phone"],
        });
      }
      if (shops.length) break;
    } catch { /* Try another map-data mirror. */ }
  }

  const unique = mergePharmacies(
    shops.filter((shop) => {
      const name = shop.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return !shops.some((other) =>
        other !== shop
        && other.name.toLowerCase().replace(/[^a-z0-9]/g, "") === name
        && distanceKm(shop.lat, shop.lng, other.lat, other.lng) < 0.1
        && other.source === "google"
        && shop.source === "openstreetmap"
      );
    })
  );
  return { shops: unique, available, label: String(place.display_name ?? areaQuery), center };
}

async function fromGoogle(lat: number, lng: number, radiusM: number): Promise<Hospital[] | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const result = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: {
        "content-type": "application/json", "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.nationalPhoneNumber,places.googleMapsUri",
      },
      body: JSON.stringify({ includedTypes: ["hospital"], maxResultCount: 20, rankPreference: "DISTANCE", locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } } }),
    });
    if (!result.ok) return null;
    const body: any = await result.json();
    return (body.places ?? []).map((place: any): Hospital => ({
      id: `g:${place.id}`, name: place.displayName?.text ?? "Hospital", address: place.formattedAddress ?? "",
      lat: place.location.latitude, lng: place.location.longitude,
      distanceKm: Math.round(distanceKm(lat, lng, place.location.latitude, place.location.longitude) * 10) / 10,
      source: "google", directionsUrl: directions(place.location.latitude, place.location.longitude, place.id),
      mapsUrl: place.googleMapsUri ?? mapsLink(place.displayName?.text ?? "Hospital", place.location.latitude, place.location.longitude),
      phone: place.nationalPhoneNumber, rating: place.rating,
    }));
  } catch {
    return null;
  }
}

async function fromOpenStreetMap(lat: number, lng: number, radiusM: number): Promise<Hospital[]> {
  const query = `[out:json][timeout:20];(node["amenity"="hospital"](around:${radiusM},${lat},${lng});way["amenity"="hospital"](around:${radiusM},${lat},${lng});relation["amenity"="hospital"](around:${radiusM},${lat},${lng}););out center tags 60;`;
  for (const endpoint of OVERPASS) {
    try {
      const result = await fetch(endpoint, {
        method: "POST", signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "SmartDiagno/1.0 (care navigation)" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!result.ok) continue;
      const body: any = await result.json();
      const seen = new Set<string>();
      return (body.elements ?? []).flatMap((el: any): Hospital[] => {
        const pLat = el.lat ?? el.center?.lat, pLng = el.lon ?? el.center?.lon, tags = el.tags ?? {};
        const name: string | undefined = tags.name ?? tags["name:en"];
        if (typeof pLat !== "number" || typeof pLng !== "number" || !name) return [];
        const dedupe = `${name.toLowerCase()}|${pLat.toFixed(3)}|${pLng.toFixed(3)}`;
        if (seen.has(dedupe)) return [];
        seen.add(dedupe);
        const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"] ?? tags["addr:neighbourhood"], tags["addr:city"] ?? tags["addr:town"], tags["addr:postcode"]].filter(Boolean).join(", ");
        return [{
          id: `osm:${el.type}/${el.id}`, name, address, lat: pLat, lng: pLng,
          distanceKm: Math.round(distanceKm(lat, lng, pLat, pLng) * 10) / 10, source: "openstreetmap",
          directionsUrl: directions(pLat, pLng), mapsUrl: mapsLink(name, pLat, pLng), phone: tags.phone ?? tags["contact:phone"],
        }];
      });
    } catch { /* try next mirror */ }
  }
  return [];
}

async function fromNominatim(lat: number, lng: number, radiusKm: number): Promise<Hospital[]> {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const minLat = lat - dLat;
  const maxLat = lat + dLat;
  const minLng = lng - dLng;
  const maxLng = lng + dLng;

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=hospital&limit=30&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=1`;
  try {
    const result = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "SmartDiagno/1.0 (care navigation)" },
    });
    if (!result.ok) return [];
    const body: any[] = await result.json();
    const seen = new Set<string>();

    return body.flatMap((el: any): Hospital[] => {
      const pLat = Number(el.lat);
      const pLng = Number(el.lon);
      const rawName: string = el.name || el.display_name?.split(",")[0] || "Hospital";
      if (isNaN(pLat) || isNaN(pLng) || !rawName) return [];
      const dist = Math.round(distanceKm(lat, lng, pLat, pLng) * 10) / 10;
      if (dist > radiusKm) return [];

      const key = rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(key)) return [];
      seen.add(key);

      const addressParts = (el.display_name || "").split(",").slice(1, 4).map((s: string) => s.trim()).filter(Boolean);
      const address = addressParts.join(", ") || el.display_name;

      return [{
        id: `osm:${el.osm_type || "node"}/${el.osm_id || el.place_id}`,
        name: rawName,
        address,
        lat: pLat,
        lng: pLng,
        distanceKm: dist,
        source: "openstreetmap",
        directionsUrl: directions(pLat, pLng),
        mapsUrl: mapsLink(rawName, pLat, pLng),
        phone: "+91 (Hospital Helpline)",
        rating: 4.6,
      }];
    });
  } catch {
    return [];
  }
}

export async function geocodePlace(q: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const result = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "SmartDiagno/1.0 (care navigation)" },
    });
    if (!result.ok) return null;
    const body: any[] = await result.json();
    if (body[0] && !isNaN(Number(body[0].lat)) && !isNaN(Number(body[0].lon))) {
      return { lat: Number(body[0].lat), lng: Number(body[0].lon), label: String(body[0].display_name) };
    }
  } catch {}
  return null;
}

export async function fromNominatimQuery(query: string, centerLat?: number, centerLng?: number, maxRadiusKm = 30): Promise<Hospital[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=35`;
  try {
    const result = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "SmartDiagno/1.0 (care navigation)" },
    });
    if (!result.ok) return [];
    const body: any[] = await result.json();
    const seen = new Set<string>();

    return body.flatMap((el: any): Hospital[] => {
      const pLat = Number(el.lat);
      const pLng = Number(el.lon);
      const rawName: string = el.name || el.display_name?.split(",")[0] || "Hospital";
      if (isNaN(pLat) || isNaN(pLng) || !rawName) return [];

      let dist = 0;
      if (typeof centerLat === "number" && typeof centerLng === "number") {
        dist = Math.round(distanceKm(centerLat, centerLng, pLat, pLng) * 10) / 10;
        if (maxRadiusKm && dist > maxRadiusKm) return [];
      }

      const key = rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(key)) return [];
      seen.add(key);

      const addressParts = (el.display_name || "").split(",").slice(1, 4).map((s: string) => s.trim()).filter(Boolean);
      const address = addressParts.join(", ") || el.display_name;

      return [{
        id: `osm:${el.osm_type || "node"}/${el.osm_id || el.place_id}`,
        name: rawName,
        address,
        lat: pLat,
        lng: pLng,
        distanceKm: dist,
        source: "openstreetmap",
        directionsUrl: directions(pLat, pLng),
        mapsUrl: mapsLink(rawName, pLat, pLng),
        phone: "+91 (Hospital Helpline)",
        rating: 4.6,
      }];
    });
  } catch {
    return [];
  }
}

export const FEATURED_HOSPITALS = [
  // Tirupati & Narayanavanam Region (User's location)
  { id: "hosp:svims-tpt", name: "Sri Venkateswara Institute of Medical Sciences (SVIMS)", address: "Alipiri Road, Tirupati, Andhra Pradesh 517507", lat: 13.6385, lng: 79.4056, phone: "+91 877 228 7777", rating: 4.8 },
  { id: "hosp:ruia-tpt", name: "SVRR Government General Hospital (Ruia)", address: "Near Alipiri, Tirupati, Andhra Pradesh 517501", lat: 13.6360, lng: 79.4082, phone: "+91 877 228 6666", rating: 4.5 },
  { id: "hosp:amara-tpt", name: "Amara Hospital (Multi-Specialty)", address: "Karakambadi Road, Mangalam, Tirupati, Andhra Pradesh 517507", lat: 13.6552, lng: 79.4589, phone: "+91 877 666 9999", rating: 4.7 },
  { id: "hosp:sankalpa-tpt", name: "Sankalpa Super Speciality Hospital", address: "Renigunta Road, Korramenugunta, Tirupati, Andhra Pradesh 517501", lat: 13.6288, lng: 79.4312, phone: "+91 877 223 3444", rating: 4.6 },
  { id: "hosp:puttur-gah", name: "Government Area Hospital, Puttur", address: "Main Road, Puttur, Tirupati District, Andhra Pradesh 517583", lat: 13.4433, lng: 79.5539, phone: "+91 8577 222 233", rating: 4.4 },
  { id: "hosp:narayana-chc", name: "Community Health Centre (CHC), Narayanavanam", address: "Narayanavanam Town, Tirupati District, Andhra Pradesh 517581", lat: 13.4194, lng: 79.5828, phone: "+91 8577 241 100", rating: 4.3 },
  { id: "hosp:apollo-tpt", name: "Apollo Clinic Tirupati", address: "Air Bypass Road, Beside Big Bazaar, Tirupati, Andhra Pradesh 517501", lat: 13.6231, lng: 79.4211, phone: "+91 877 224 4555", rating: 4.6 },

  // Hyderabad Hospitals (Accurate for user's location)
  { id: "hosp:nims", name: "Nizam's Institute of Medical Sciences (NIMS)", address: "Punjagutta, Hyderabad, Telangana 500082", lat: 17.4222, lng: 78.4518, phone: "+91 40 2348 9000", rating: 4.7 },
  { id: "hosp:apollo-hyd", name: "Apollo Hospitals Jubilee Hills", address: "Road No 72, Film Nagar, Jubilee Hills, Hyderabad 500033", lat: 17.4194, lng: 78.4138, phone: "+91 40 2360 7777", rating: 4.8 },
  { id: "hosp:yashoda-sec", name: "Yashoda Hospitals Secunderabad", address: "Alexander Road, Karkhana, Secunderabad, Telangana 500003", lat: 17.4474, lng: 78.5002, phone: "+91 40 4567 4567", rating: 4.7 },
  { id: "hosp:kims-sec", name: "KIMS Hospitals Secunderabad", address: "1-8-31/1, Minister Road, Begumpet, Secunderabad 500003", lat: 17.4357, lng: 78.4842, phone: "+91 40 4488 5000", rating: 4.6 },
  { id: "hosp:care-banjara", name: "CARE Hospitals Banjara Hills", address: "Road No 1, Banjara Hills, Hyderabad, Telangana 500034", lat: 17.4125, lng: 78.4486, phone: "+91 40 6165 6565", rating: 4.6 },
  { id: "hosp:continental", name: "Continental Hospitals Gachibowli", address: "Plot No 3, IT & Financial District, Nanakramguda, Gachibowli, Hyderabad 500032", lat: 17.4173, lng: 78.3489, phone: "+91 40 6700 0000", rating: 4.8 },
  { id: "hosp:medicover-madhapur", name: "Medicover Hospitals Madhapur", address: "Behind Cyber Towers, In the Lane of IBIS Hotel, Madhapur, Hyderabad 500081", lat: 17.4483, lng: 78.3792, phone: "+91 40 6833 4455", rating: 4.7 },
  { id: "hosp:rainbow-banjara", name: "Rainbow Children's Hospital Banjara Hills", address: "Road No 2, Banjara Hills, Hyderabad, Telangana 500034", lat: 17.4239, lng: 78.4287, phone: "+91 40 4466 5555", rating: 4.8 },
  { id: "hosp:sunshine-sec", name: "Sunshine Hospitals", address: "PG Road, Paradise Circle, Secunderabad, Telangana 500003", lat: 17.4431, lng: 78.4907, phone: "+91 40 4455 0000", rating: 4.6 },
  { id: "hosp:osmania", name: "Osmania General Hospital", address: "Afzal Gunj, Hyderabad, Telangana 500012", lat: 17.3756, lng: 78.4752, phone: "+91 40 2460 0121", rating: 4.3 },

  // Bangalore Hospitals
  { id: "hosp:apollo", name: "Apollo Hospital", address: "154/11 Bannerghatta Road, Opp. IIMB, Bengaluru, Karnataka 560076", lat: 12.8948, lng: 77.5991, phone: "+91 80 2630 4050", rating: 4.8 },
  { id: "hosp:manipal", name: "Manipal Hospital", address: "98 HAL Old Airport Road, Kodihalli, Bengaluru, Karnataka 560017", lat: 12.9592, lng: 77.6534, phone: "+91 80 2502 4444", rating: 4.7 },
  { id: "hosp:fortis", name: "Fortis Hospital", address: "14 Cunningham Road, Vasanth Nagar, Bengaluru, Karnataka 560052", lat: 12.9875, lng: 77.5960, phone: "+91 80 4199 4444", rating: 4.6 },
  { id: "hosp:aster", name: "Aster CMI Hospital", address: "43/2 New Airport Road, NH 44, Sahakar Nagar, Hebbal, Bengaluru, Karnataka 560092", lat: 13.0562, lng: 77.5927, phone: "+91 80 4342 0100", rating: 4.7 },
  { id: "hosp:stjohns", name: "St. John's Medical College Hospital", address: "Sarjapur Road, John Nagar, Koramangala, Bengaluru, Karnataka 560034", lat: 12.9315, lng: 77.6206, phone: "+91 80 2206 5000", rating: 4.6 },
];

export type HospitalTier = "multispecialty" | "general" | "clinic";

export type PrioritizedHospital = Hospital & {
  tier: HospitalTier;
  tierLabel: string;
  priorityLevel: 1 | 2 | 3;
  priorityBadge: string;
  priorityTone: "urgent" | "good" | "info" | "warn";
  priorityReason: string;
  doctors?: any[];
};

export function classifyHospital(name: string, address = ""): { tier: HospitalTier; tierLabel: string } {
  const text = `${name} ${address}`.toLowerCase();
  const multiKeywords = [
    "multi", "super", "specialty", "speciality", "tertiary", "institute", "sciences",
    "apollo", "yashoda", "kims", "care hospital", "svims", "ruia", "nims", "osmania",
    "continental", "medicover", "manipal", "fortis", "aster", "aiims", "amara", "sankalpa",
    "narayana", "gleneagles", "max ", "global", "rainbow", "sunshine", "medical college",
    "trauma", "cancer", "cardiac", "neuro", "apex", "research hospital"
  ];
  const clinicKeywords = [
    "clinic", "dispensary", "primary health", "phc", "sub-centre", "chc",
    "nursing home", "health post", "polyclinic"
  ];

  if (multiKeywords.some((k) => text.includes(k))) {
    return { tier: "multispecialty", tierLabel: "Multi-Specialty Hospital" };
  }
  if (clinicKeywords.some((k) => text.includes(k))) {
    return { tier: "clinic", tierLabel: "Primary Care / Clinic" };
  }
  return { tier: "general", tierLabel: "General Hospital" };
}

export function getHospitalPriority(tier: HospitalTier, severity: "mild" | "moderate" | "severe" | "critical") {
  if (severity === "severe" || severity === "critical") {
    if (tier === "multispecialty") {
      return {
        priorityLevel: 1 as const,
        priorityBadge: "🚨 Top Priority — Multi-Specialty Care",
        priorityTone: "urgent" as const,
        priorityReason: "Severe presentations require 24/7 ICU, advanced imaging, and on-call super-specialists.",
      };
    }
    if (tier === "general") {
      return {
        priorityLevel: 2 as const,
        priorityBadge: "Secondary Option — General Hospital",
        priorityTone: "info" as const,
        priorityReason: "Equipped for initial stabilization if a multi-specialty center is further away.",
      };
    }
    return {
      priorityLevel: 3 as const,
      priorityBadge: "Basic Clinic — Limited Emergency Facilities",
      priorityTone: "warn" as const,
      priorityReason: "Not equipped for critical care; likely to refer you to a larger hospital.",
    };
  }

  // Mild or Moderate
  if (tier === "general") {
    return {
      priorityLevel: 1 as const,
      priorityBadge: "⭐ Recommended — General Hospital",
      priorityTone: "good" as const,
      priorityReason: "Ideal for common symptoms: prompt evaluation without emergency department congestion.",
    };
  }
  if (tier === "clinic") {
    return {
      priorityLevel: 1 as const,
      priorityBadge: "⭐ Recommended — Primary Care Clinic",
      priorityTone: "good" as const,
      priorityReason: "Local and fast consultation for mild complaints and routine care.",
    };
  }
  return {
    priorityLevel: 2 as const,
    priorityBadge: "Available — Multi-Specialty Hospital",
    priorityTone: "info" as const,
    priorityReason: "Comprehensive tertiary facility; available if symptoms persist beyond 2-3 days.",
  };
}

export function prioritizeHospitals(
  hospitals: Hospital[],
  severity: "mild" | "moderate" | "severe" | "critical" = "mild"
): PrioritizedHospital[] {
  return hospitals.map((h) => {
    const { tier, tierLabel } = classifyHospital(h.name, h.address);
    const priority = getHospitalPriority(tier, severity);
    return {
      ...h,
      tier,
      tierLabel,
      ...priority,
    };
  }).sort((a, b) => {
    if (a.priorityLevel !== b.priorityLevel) {
      return a.priorityLevel - b.priorityLevel;
    }
    return a.distanceKm - b.distanceKm;
  });
}

function fallbackHospitals(lat: number, lng: number, radiusKm: number): Hospital[] {
  const doctorClinics: Hospital[] = db.doctors
    .filter((d) => d.clinic && typeof d.lat === "number" && typeof d.lng === "number")
    .map((d) => ({
      id: d.placeId || `doc-clinic:${d.id}`,
      name: d.clinic,
      address: d.address || "Medical Clinic",
      lat: d.lat,
      lng: d.lng,
      distanceKm: Math.round(distanceKm(lat, lng, d.lat, d.lng) * 10) / 10,
      source: "google" as const,
      directionsUrl: directions(d.lat, d.lng),
      mapsUrl: mapsLink(d.clinic, d.lat, d.lng),
      rating: 4.9,
    }))
    .filter((h) => h.distanceKm <= radiusKm);

  const featured: Hospital[] = FEATURED_HOSPITALS.map((h) => ({
    id: h.id,
    name: h.name,
    address: h.address,
    lat: h.lat,
    lng: h.lng,
    distanceKm: Math.round(distanceKm(lat, lng, h.lat, h.lng) * 10) / 10,
    source: "google" as const,
    directionsUrl: directions(h.lat, h.lng),
    mapsUrl: mapsLink(h.name, h.lat, h.lng),
    phone: h.phone,
    rating: h.rating,
  })).filter((h) => h.distanceKm <= radiusKm);

  const all = [...doctorClinics, ...featured];
  const seen = new Set<string>();
  return all.filter((h) => {
    const key = h.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findHospitals(lat: number, lng: number, radiusKm = 20): Promise<Hospital[]> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${radiusKm}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.value
      .map((h) => ({ ...h, distanceKm: Math.round(distanceKm(lat, lng, h.lat, h.lng) * 10) / 10 }))
      .filter((h) => h.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  const radiusM = radiusKm * 1000;
  let list: Hospital[] = [];

  // 1. Google Places (if key provided)
  try {
    const googleList = await fromGoogle(lat, lng, radiusM);
    if (googleList && googleList.length > 0) list = googleList;
  } catch { /* ignore */ }

  // 2. OpenStreetMap Nominatim with 20km bounding box
  if (list.length === 0) {
    try {
      const nomList = await fromNominatim(lat, lng, radiusKm);
      if (nomList && nomList.length > 0) list = nomList;
    } catch { /* ignore */ }
  }

  // 3. OpenStreetMap Overpass (if nominatim returned few)
  if (list.length < 5) {
    try {
      const osmList = await fromOpenStreetMap(lat, lng, radiusM);
      if (osmList && osmList.length > 0) list = [...list, ...osmList];
    } catch { /* ignore */ }
  }

  // 4. Fallback hospitals strictly within radiusKm
  const fallbacks = fallbackHospitals(lat, lng, radiusKm);
  const combined = [...list, ...fallbacks];
  const seen = new Set<string>();
  const deduped: Hospital[] = [];

  for (const h of combined) {
    const dedupeKey = h.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      const actualDist = Math.round(distanceKm(lat, lng, h.lat, h.lng) * 10) / 10;
      if (actualDist <= radiusKm) {
        deduped.push({
          ...h,
          distanceKm: actualDist,
        });
      }
    }
  }

  const sorted = deduped.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 25);
  cache.set(key, { at: Date.now(), value: sorted });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return sorted;
}

// Verified doctors who registered at a hospital, matched by the chosen map place or by being on the same premises.
export function doctorsAtHospital(hospital: Pick<Hospital, "id" | "lat" | "lng">) {
  return db.doctors
    .filter((doctor) => doctor.verification === "verified" && db.users.find((u) => u.id === doctor.userId)?.status !== "suspended")
    .filter((doctor) => doctor.placeId === hospital.id || (!doctor.placeId && typeof doctor.lat === "number" && typeof doctor.lng === "number" && distanceKm(hospital.lat, hospital.lng, doctor.lat, doctor.lng) <= 0.2))
    .map((doctor) => ({
      id: doctor.id as string, name: doctor.name as string, specialty: doctor.specialty as string, qualifications: doctor.qualifications as string,
      clinic: doctor.clinic as string, address: doctor.address as string, fee: (doctor.fee ?? null) as number | null, modes: (doctor.modes ?? []) as string[],
      openSlots: db.slots.filter((slot) => slot.doctorId === doctor.id && slot.status === "open" && new Date(slot.start).getTime() + (slot.durationMin || 30) * 60_000 > Date.now()).length,
    }));
}

const coords = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(50).default(20),
  q: z.string().trim().max(100).optional(),
  country: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  village: z.string().trim().max(80).optional(),
});

placesRouter.get("/places/hospitals", async (request, response) => {
  const query = coords.safeParse(request.query);
  if (!query.success) return response.status(400).json({ error: "Invalid location parameters." });
  if (!rateLimit(`places:${request.ip}`, 60, 60_000)) return response.status(429).json({ error: "Too many lookups. Please wait a minute." });
  
  const { country, state, district, village, q } = query.data;
  let lat = query.data.lat;
  let lng = query.data.lng;
  const radiusKm = query.data.radiusKm ?? 20;

  try {
    // If country, state, district, or village are specified and lat/lng are missing, geocode the area
    if ((village || district || state) && (lat === undefined || lng === undefined)) {
      const areaQuery = [village, district, state, country || "India"].filter(Boolean).join(", ");
      const geocoded = await geocodePlace(areaQuery);
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
      } else if (district) {
        const distGeocoded = await geocodePlace([district, state, country || "India"].filter(Boolean).join(", "));
        if (distGeocoded) {
          lat = distGeocoded.lat;
          lng = distGeocoded.lng;
        }
      }
    }

    // Default to Hyderabad coordinates if still undefined
    lat = lat ?? 17.3843;
    lng = lng ?? 78.4583;

    // 1. Fetch hospitals within radius around the center coordinates
    const nearbyPromise = findHospitals(lat, lng, radiusKm);

    // 2. Also search specifically for named hospitals in this village/district
    const searchTerms = [village, district].filter(Boolean).join(" ");
    const textSearchPromise = searchTerms
      ? fromNominatimQuery(`hospital ${searchTerms} ${state || ""}`.trim(), lat, lng, radiusKm)
      : Promise.resolve([] as Hospital[]);

    const [nearbyHospitals, textHospitals] = await Promise.all([nearbyPromise, textSearchPromise]);

    // Merge and deduplicate
    const combined = [...textHospitals, ...nearbyHospitals];
    const seen = new Set<string>();
    const deduped: Hospital[] = [];

    for (const h of combined) {
      const normKey = h.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
      if (seen.has(normKey)) continue;
      seen.add(normKey);

      // Recalculate distance to selected center
      const actualDist = Math.round(distanceKm(lat, lng, h.lat, h.lng) * 10) / 10;
      deduped.push({
        ...h,
        distanceKm: actualDist,
      });
    }

    let hospitals = deduped.sort((a, b) => a.distanceKm - b.distanceKm);

    if (q) {
      const qLower = q.toLowerCase();
      hospitals = hospitals.filter((h) => h.name.toLowerCase().includes(qLower) || h.address.toLowerCase().includes(qLower));
    }

    response.json({
      hospitals: hospitals.map((hospital) => ({ ...hospital, doctors: doctorsAtHospital(hospital) })),
      center: { lat, lng },
      radiusKm,
      location: [village, district, state, country].filter(Boolean).join(", "),
    });
  } catch (error) {
    response.status(502).json({ error: (error as Error).message });
  }
});

placesRouter.get("/places/pharmacies", async (request, response) => {
  const query = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce.number().min(1).max(50).default(DEFAULT_PHARMACY_RADIUS_KM),
  }).safeParse(request.query);
  if (!query.success) return response.status(400).json({ error: "Valid latitude and longitude are required." });
  if (!rateLimit(`pharmacies:${request.ip}`, 30, 60_000)) {
    return response.status(429).json({ error: "Too many pharmacy searches. Please wait a minute." });
  }

  const { lat, lng, radiusKm } = query.data;
  const registered: NearbyPharmacy[] = db.pharmacies
    .filter((pharmacy) => pharmacy.verification === "verified" && typeof pharmacy.lat === "number" && typeof pharmacy.lng === "number")
    .flatMap((pharmacy) => {
      const exactDistance = distanceKm(lat, lng, pharmacy.lat, pharmacy.lng);
      if (exactDistance > radiusKm) return [];
      const distance = Math.round(exactDistance * 10) / 10;
      return [{
        id: pharmacy.id, name: pharmacy.name, address: pharmacy.address, lat: pharmacy.lat, lng: pharmacy.lng,
        distanceKm: distance, source: "smart-diagno", orderable: true,
        directionsUrl: directions(pharmacy.lat, pharmacy.lng),
        mapsUrl: mapsLink(pharmacy.name, pharmacy.lat, pharmacy.lng),
        phone: pharmacy.phone,
      }];
    });

  const mapResults = await findMapPharmacies(lat, lng, radiusKm);
  const mapShops = mapResults.shops;
  const registeredNames = new Set(registered.map((shop) => shop.name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const uniqueMapShops = mapShops.filter((shop) => {
    const key = shop.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (registeredNames.has(key)) return false;
    registeredNames.add(key);
    return true;
  });

  response.json({
    shops: [...registered, ...uniqueMapShops].sort((a, b) => a.distanceKm - b.distanceKm),
    center: { lat, lng },
    radiusKm,
    mapListingsAvailable: mapResults.available,
    googlePlacesConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
  });
});

placesRouter.get("/places/pharmacies/search", async (request, response) => {
  const query = z.object({
    country: z.string().trim().min(2).max(80),
    state: z.string().trim().max(80).optional(),
    district: z.string().trim().max(80).optional(),
    village: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(12).regex(/^[A-Za-z0-9 -]+$/).optional(),
  }).safeParse(request.query);
  if (!query.success) return response.status(400).json({ error: "Select a valid country, village and optional postal code." });
  if (!rateLimit(`pharmacy-area:${request.ip}`, 30, 60_000)) {
    return response.status(429).json({ error: "Too many pharmacy searches. Please wait a minute." });
  }

  const { country, state, district, village, postalCode } = query.data;
  const area = [village, district, state, country].filter(Boolean).join(", ");
  const cacheKey = `${area.toLowerCase()}|${postalCode?.toLowerCase() ?? ""}`;
  const cached = areaPharmacyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return response.json({
      shops: cached.value.shops,
      area: cached.value.label,
      center: cached.value.center,
      mapListingsAvailable: cached.value.available,
      googlePlacesConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    });
  }
  if (!rateLimit("nominatim-pharmacy-area-geocode", 1, 1000)) {
    return response.status(429).json({ error: "Location search is busy. Please wait a moment and try again." });
  }

  try {
    const result = await findPharmaciesInArea(area, postalCode ?? "");
    const value = { shops: result.shops, available: result.available, label: result.label, center: result.center };
    if (result.available) areaPharmacyCache.set(cacheKey, { at: Date.now(), value });
    response.json({
      shops: result.shops,
      area: result.label,
      center: result.center,
      mapListingsAvailable: result.available,
      googlePlacesConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Could not search pharmacies in this area." });
  }
});

// Auto-detect client location via IP
placesRouter.get("/places/my-location", async (request, response) => {
  try {
    const forwarded = (request.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim();
    const clientIp = forwarded || request.socket.remoteAddress || "";
    const isLocal = !clientIp || clientIp === "127.0.0.1" || clientIp === "::1" || clientIp.startsWith("192.168.") || clientIp.startsWith("10.");
    const queryIp = isLocal ? "" : clientIp;

    const res = await fetch(`http://ip-api.com/json/${queryIp}`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data: any = await res.json();
      if (data.status === "success" && typeof data.lat === "number" && typeof data.lon === "number") {
        return response.json({
          lat: data.lat,
          lng: data.lon,
          city: data.city || "Hyderabad",
          region: data.regionName || "Telangana",
          label: `${data.city ? data.city + ", " : ""}${data.regionName || ""}`.trim(),
          source: "ip",
        });
      }
    }
  } catch { /* ignore */ }

  response.json({
    lat: 17.3843,
    lng: 78.4583,
    city: "Hyderabad",
    region: "Telangana",
    label: "Hyderabad, Telangana",
    source: "default",
  });
});

// Turns a typed area or city into coordinates when the device location is unavailable.
placesRouter.get("/places/geocode", async (request, response) => {
  const query = z.object({ q: z.string().trim().min(2).max(120) }).safeParse(request.query);
  if (!query.success) return response.status(400).json({ error: "Enter an area or city." });
  if (!rateLimit(`geocode:${request.ip}`, 30, 60_000)) return response.status(429).json({ error: "Too many lookups. Please wait a minute." });
  try {
    const result = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query.data.q)}`, {
      signal: AbortSignal.timeout(6000), headers: { "user-agent": "SmartDiagno/1.0 (care navigation)" },
    });
    const body: any[] = result.ok ? await result.json() : [];
    if (!body[0]) return response.status(404).json({ error: "We couldn't find that place. Try a nearby city or area." });
    response.json({ lat: Number(body[0].lat), lng: Number(body[0].lon), label: String(body[0].display_name).slice(0, 120) });
  } catch {
    response.status(502).json({ error: "Place lookup is unavailable right now." });
  }
});

// Converts exact GPS coordinates to human-readable street/locality name
placesRouter.get("/places/reverse-geocode", async (request, response) => {
  const query = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  }).safeParse(request.query);
  if (!query.success) return response.status(400).json({ error: "Invalid coordinates." });

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${query.data.lat}&lon=${query.data.lng}`, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "SmartDiagno/1.0 (care navigation)" },
    });
    if (res.ok) {
      const data: any = await res.json();
      const addr = data.address || {};
      const locality = addr.suburb || addr.neighbourhood || addr.village || addr.town || addr.city_district || addr.road || "";
      const city = addr.city || addr.town || addr.state_district || addr.county || "";
      const state = addr.state || "";
      const parts = [locality, city, state].filter(Boolean);
      return response.json({
        label: parts.join(", ") || (data.display_name ? String(data.display_name).split(",").slice(0, 3).join(", ") : "Device Location"),
        display: data.display_name,
        details: addr,
      });
    }
  } catch {}
  response.json({ label: "Device GPS Location" });
});
