// Approximate rectangular bounding boxes used to resolve an event's country
// from its stored latitude/longitude for filtering purposes. These are NOT
// precise polygon borders — they're simple lat/lng rectangles, cheap to
// evaluate and consistent with the $geoWithin-style geo queries already used
// elsewhere in this codebase (near-me search). Two deliberate trade-offs:
//   1. Coverage is comprehensive for Africa plus a short list of diaspora
//      hubs (UK, US, Canada, UAE) this Nigeria-centric platform plausibly
//      sees events in — not all ~195 UN member states. Coordinates for
//      lesser-covered countries would carry real accuracy risk if hand
//      authored from memory, so the list intentionally stops there.
//   2. Any coordinate outside every listed box resolves to "Other" rather
//      than guessing, and rectangles can misattribute points near a shared
//      border (e.g. Togo/Ghana, Niger/Nigeria) since they aren't true
//      polygons. Acceptable for a coarse discovery filter, not a legal or
//      billing boundary.
const COUNTRY_BOUNDING_BOXES = [
  { name: "Nigeria", minLat: 4.0, maxLat: 14.0, minLng: 2.6, maxLng: 14.7 },
  { name: "Ghana", minLat: 4.5, maxLat: 11.2, minLng: -3.3, maxLng: 1.3 },
  { name: "Benin", minLat: 6.2, maxLat: 12.4, minLng: 0.7, maxLng: 3.9 },
  { name: "Togo", minLat: 6.0, maxLat: 11.2, minLng: -0.2, maxLng: 1.8 },
  { name: "Ivory Coast", minLat: 4.3, maxLat: 10.8, minLng: -8.6, maxLng: -2.5 },
  { name: "Liberia", minLat: 4.3, maxLat: 8.6, minLng: -11.5, maxLng: -7.4 },
  { name: "Sierra Leone", minLat: 6.9, maxLat: 10.0, minLng: -13.3, maxLng: -10.3 },
  { name: "Guinea", minLat: 7.2, maxLat: 12.7, minLng: -15.1, maxLng: -7.6 },
  { name: "Guinea-Bissau", minLat: 10.9, maxLat: 12.7, minLng: -16.8, maxLng: -13.6 },
  { name: "Senegal", minLat: 12.3, maxLat: 16.7, minLng: -17.6, maxLng: -11.3 },
  { name: "Gambia", minLat: 13.0, maxLat: 13.9, minLng: -16.9, maxLng: -13.8 },
  { name: "Mali", minLat: 10.1, maxLat: 25.0, minLng: -12.3, maxLng: 4.3 },
  { name: "Burkina Faso", minLat: 9.4, maxLat: 15.1, minLng: -5.6, maxLng: 2.4 },
  { name: "Niger", minLat: 11.6, maxLat: 23.6, minLng: 0.1, maxLng: 16.0 },
  { name: "Cameroon", minLat: 1.6, maxLat: 13.1, minLng: 8.4, maxLng: 16.2 },
  { name: "Chad", minLat: 7.4, maxLat: 23.5, minLng: 13.4, maxLng: 24.0 },
  { name: "Central African Republic", minLat: 2.2, maxLat: 11.0, minLng: 14.4, maxLng: 27.5 },
  { name: "Equatorial Guinea", minLat: 0.9, maxLat: 2.3, minLng: 9.3, maxLng: 11.4 },
  { name: "Gabon", minLat: -3.9, maxLat: 2.3, minLng: 8.7, maxLng: 14.5 },
  { name: "Republic of the Congo", minLat: -5.0, maxLat: 3.7, minLng: 11.1, maxLng: 18.6 },
  { name: "DR Congo", minLat: -13.5, maxLat: 5.4, minLng: 12.2, maxLng: 31.3 },
  { name: "Angola", minLat: -18.0, maxLat: -4.4, minLng: 11.7, maxLng: 24.1 },
  { name: "Zambia", minLat: -18.1, maxLat: -8.2, minLng: 21.9, maxLng: 33.7 },
  { name: "Malawi", minLat: -17.2, maxLat: -9.4, minLng: 32.7, maxLng: 35.9 },
  { name: "Mozambique", minLat: -26.9, maxLat: -10.5, minLng: 30.2, maxLng: 40.8 },
  { name: "Zimbabwe", minLat: -22.4, maxLat: -15.6, minLng: 25.2, maxLng: 33.1 },
  { name: "Botswana", minLat: -26.9, maxLat: -17.8, minLng: 19.9, maxLng: 29.4 },
  { name: "Namibia", minLat: -28.9, maxLat: -16.9, minLng: 11.7, maxLng: 25.3 },
  { name: "South Africa", minLat: -34.9, maxLat: -22.1, minLng: 16.5, maxLng: 32.9 },
  { name: "Lesotho", minLat: -30.7, maxLat: -28.6, minLng: 27.0, maxLng: 29.5 },
  { name: "Eswatini", minLat: -27.3, maxLat: -25.7, minLng: 30.8, maxLng: 32.1 },
  { name: "Kenya", minLat: -4.7, maxLat: 5.5, minLng: 33.9, maxLng: 41.9 },
  { name: "Uganda", minLat: -1.5, maxLat: 4.2, minLng: 29.6, maxLng: 35.0 },
  { name: "Tanzania", minLat: -11.8, maxLat: -0.9, minLng: 29.3, maxLng: 40.5 },
  { name: "Rwanda", minLat: -2.9, maxLat: -1.0, minLng: 28.9, maxLng: 30.9 },
  { name: "Burundi", minLat: -4.5, maxLat: -2.3, minLng: 29.0, maxLng: 30.9 },
  { name: "Ethiopia", minLat: 3.4, maxLat: 14.9, minLng: 33.0, maxLng: 48.0 },
  { name: "South Sudan", minLat: 3.5, maxLat: 12.3, minLng: 24.1, maxLng: 35.9 },
  { name: "Sudan", minLat: 8.6, maxLat: 22.2, minLng: 21.8, maxLng: 38.6 },
  { name: "Somalia", minLat: -1.7, maxLat: 12.0, minLng: 40.9, maxLng: 51.4 },
  { name: "Djibouti", minLat: 10.9, maxLat: 12.7, minLng: 41.7, maxLng: 43.4 },
  { name: "Eritrea", minLat: 12.4, maxLat: 18.0, minLng: 36.4, maxLng: 43.1 },
  { name: "Egypt", minLat: 22.0, maxLat: 31.7, minLng: 24.7, maxLng: 36.9 },
  { name: "Libya", minLat: 19.5, maxLat: 33.2, minLng: 9.3, maxLng: 25.2 },
  { name: "Tunisia", minLat: 30.2, maxLat: 37.6, minLng: 7.5, maxLng: 11.6 },
  { name: "Algeria", minLat: 18.9, maxLat: 37.1, minLng: -8.7, maxLng: 12.0 },
  { name: "Morocco", minLat: 27.6, maxLat: 35.9, minLng: -13.2, maxLng: -1.0 },
  { name: "Mauritania", minLat: 14.7, maxLat: 27.3, minLng: -17.1, maxLng: -4.8 },
  { name: "Cape Verde", minLat: 14.8, maxLat: 17.2, minLng: -25.4, maxLng: -22.7 },
  { name: "Madagascar", minLat: -25.6, maxLat: -11.9, minLng: 43.2, maxLng: 50.5 },
  { name: "Mauritius", minLat: -20.6, maxLat: -19.9, minLng: 57.3, maxLng: 57.8 },
  { name: "Seychelles", minLat: -5.7, maxLat: -3.7, minLng: 55.1, maxLng: 56.3 },
  { name: "Comoros", minLat: -12.5, maxLat: -11.4, minLng: 43.1, maxLng: 44.6 },
  { name: "United Kingdom", minLat: 49.8, maxLat: 60.9, minLng: -8.6, maxLng: 1.8 },
  { name: "United States", minLat: 24.5, maxLat: 49.4, minLng: -125.0, maxLng: -66.9 },
  { name: "Canada", minLat: 41.7, maxLat: 83.1, minLng: -141.0, maxLng: -52.6 },
  { name: "United Arab Emirates", minLat: 22.5, maxLat: 26.1, minLng: 51.0, maxLng: 56.4 },
];

const resolveCountryFromCoordinates = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "Other";
  }

  const match = COUNTRY_BOUNDING_BOXES.find(
    (box) => lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng,
  );

  return match ? match.name : "Other";
};

module.exports = { COUNTRY_BOUNDING_BOXES, resolveCountryFromCoordinates };
