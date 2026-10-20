export interface Coordinates {
  lat: number;
  lng: number;
}

export function detectDeviceLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Device location is not available in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => reject(new Error("Device location permission was denied or unavailable.")),
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true }
    );
  });
}
