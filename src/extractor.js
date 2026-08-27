/**
 * Cleans and normalizes raw business data extracted from Google Maps.
 */
export function extractBusinessData(rawBusiness, searchQuery) {
    const {
        businessName,
        category,
        address,
        phone,
        priceLevel,
        rating,
        reviewCount,
        placeUrl,
        imageUrl,
        website,
        latitude,
        longitude,
        openingHours,
    } = rawBusiness;

    // Extract coordinates from the place URL if available
    const coords = extractCoordinates(placeUrl);

    return {
        searchQuery,
        businessName: cleanText(businessName),
        category: cleanCategory(category),
        address: cleanText(address),
        phone: normalizePhone(phone),
        website: website || '',
        rating: rating ? Math.round(rating * 10) / 10 : null,
        reviewCount: reviewCount || null,
        priceLevel: priceLevel || '',
        openingHours: openingHours || null,
        latitude: latitude || coords.lat,
        longitude: longitude || coords.lng,
        placeUrl: placeUrl || '',
        imageUrl: imageUrl || '',
        scrapedAt: new Date().toISOString(),
    };
}

/**
 * Extracts latitude and longitude from a Google Maps URL.
 * Result-card URLs carry them as "!8m2!3d25.77!4d-80.18"; shared/browser URLs
 * as "@37.7749,-122.4194,15z". Both are supported.
 */
function extractCoordinates(url) {
    if (!url) return { lat: null, lng: null };

    const at = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (at) {
        return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
    }

    const dm = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
    if (dm) {
        return { lat: parseFloat(dm[1]), lng: parseFloat(dm[2]) };
    }

    return { lat: null, lng: null };
}

/**
 * Normalizes phone numbers. Last line of defence: anything that is not
 * phone-shaped (letters, concatenated card blobs) is dropped instead of
 * being delivered as a "phone".
 */
function normalizePhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/\s+/g, ' ').trim();
    if (!/^\+?\(?\d[\d\s().\-]{5,18}\d\)?$/.test(cleaned)) return '';
    if ((cleaned.match(/\d/g) || []).length < 7) return '';
    return cleaned;
}

/**
 * Category must be a plain label. Strips any rating/review numbers that the
 * Maps card may have glued in front ("4.9(1,964)Dentist" -> "Dentist") and
 * rejects a value that is only a number.
 */
function cleanCategory(category) {
    let c = cleanText(category);
    if (!c) return '';
    c = c.replace(/^\d+(\.\d+)?\s*(\(\s*\d[\d,.]*\s*\))?\s*/, '').trim();
    c = c.replace(/^[·⋅\-–]\s*/, '').trim();
    if (/^\d+(\.\d+)?$/.test(c)) return '';
    return c;
}

/**
 * Cleans text by removing extra whitespace and trimming.
 */
function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
}
