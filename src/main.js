import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { extractBusinessData } from './extractor.js';

await Actor.init();

const input = await Actor.getInput();
const {
    searchQueries = [],
    maxResultsPerQuery = 100,
    language = 'en',
    maxConcurrency = 1,
    includeWebsite = false,
    // Opening each place page is what makes phone, opening hours and the real
    // website available at all. On by default because the output schema promises
    // those fields; turn it off for a fast, listing-only sweep.
    includeDetails = true,
} = input ?? {};

if (!searchQueries.length) {
    throw new Error('At least one search query is required.');
}

console.log(`Starting Google Maps scraper with ${searchQueries.length} queries, max ${maxResultsPerQuery} results each.`);

// Use datacenter proxies (cheaper than residential).
const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['BUYPROXIES94952'],
}).catch(() => {
    console.log('Datacenter proxies not available, running without proxy.');
    return undefined;
});

const failures = [];
// Businesses already delivered, keyed by placeUrl - dedupes across queries so
// the same place is never billed twice.
const byKey = new Map();
let detailHits = 0;
let detailMisses = 0;

/**
 * Reads the fields that only exist on a place's own page: phone, website, full
 * address, review count and opening hours.
 *
 * Google exposes these through `data-item-id` attributes, which survive layout and
 * language changes — the phone number is inside the attribute itself
 * (`data-item-id="phone:tel:+14809635089"`), so there is no text to misparse.
 * Never throws: a place whose detail page fails still ships with its feed data.
 */
async function scrapeDetail(page, placeUrl, log) {
    try {
        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // The panel renders after navigation; the address block is the anchor we wait on.
        await page.waitForSelector('[data-item-id="address"], [data-item-id^="phone:tel:"]', { timeout: 8000 })
            .catch(() => {});

        return await page.evaluate(() => {
            const txt = (el) => (el?.textContent || '').trim();

            const phoneEl = document.querySelector('[data-item-id^="phone:tel:"]');
            const phone = phoneEl ? phoneEl.getAttribute('data-item-id').replace('phone:tel:', '') : '';

            const siteEl = document.querySelector('a[data-item-id="authority"]');
            const website = siteEl ? siteEl.href : '';

            const addrEl = document.querySelector('[data-item-id="address"]');
            const address = addrEl
                ? (addrEl.getAttribute('aria-label') || '').replace(/^Address:\s*/i, '').trim()
                : '';

            // "4.9(514)" — rating and review count live in the same node.
            const rt = txt(document.querySelector('div.F7nice'));
            const rm = rt.match(/([\d.,]+)\s*\(([\d,.]+)\)/);
            const rating = rm ? parseFloat(rm[1].replace(',', '.')) : null;
            const reviewCount = rm ? parseInt(rm[2].replace(/[.,]/g, ''), 10) : null;

            const openingHours = Array.from(document.querySelectorAll('table.eK4R0e tr, [aria-label*="Hours"] tr'))
                .map((r) => {
                    const c = r.querySelectorAll('td');
                    //   is the narrow no-break space Google puts inside "8 AM–5 PM".
                    return c.length >= 2 ? `${txt(c[0])}: ${txt(c[1]).replace(/ /g, ' ')}` : null;
                })
                .filter(Boolean);

            const category = txt(document.querySelector('button[jsaction*="category"]'));

            return { phone, website, address, rating, reviewCount, openingHours, category };
        });
    } catch (e) {
        log.warning(`Detail page failed for ${placeUrl}: ${e.message}`);
        return null;
    }
}

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency,
    maxRequestRetries: 3,
    navigationTimeoutSecs: 45,
    // Each place page adds a navigation, so the handler needs room for
    // maxResultsPerQuery of them. Without this a large run with details on
    // would be killed mid-way by the old flat 120s budget.
    requestHandlerTimeoutSecs: includeDetails
        ? Math.min(3300, 180 + maxResultsPerQuery * 6)
        : 120,
    headless: true,
    launchContext: {
        launchOptions: {
            args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'],
        },
    },
    requestHandler: async ({ page, request, log }) => {
        const { searchQuery } = request.userData;
        log.info(`Processing search: "${searchQuery}"`);

        await page.waitForLoadState('domcontentloaded').catch(() => {});

        await page.click('button[aria-label="Accept all"]').catch(() => {});
        await page.waitForTimeout(800);

        const feedSelector = 'div[role="feed"]';
        await page.waitForSelector(feedSelector, { timeout: 12000 }).catch(() => {
            log.warning('Results feed not found, trying alternative selectors...');
        });

        let detailRouteReady = false;
        const businesses = await scrollAndExtract(page, maxResultsPerQuery, log);
        log.info(`Extracted ${businesses.length} businesses for "${searchQuery}"`);

        // Zero results almost always means Google served a block/consent page to this session.
        // Throw so Crawlee retries with a fresh browser session instead of returning an empty dataset.
        if (businesses.length === 0) {
            throw new Error(`No businesses extracted for "${searchQuery}" — likely a Google block; retrying with a fresh session.`);
        }

        for (const business of businesses) {
            const cleaned = extractBusinessData(business, searchQuery);
            const key = cleaned.placeUrl || `${cleaned.businessName}|${cleaned.address}`;
            if (byKey.has(key)) continue;

            // The results feed carries name, category, a partial address and the rating —
            // and nothing else. Phone, opening hours, the real website and the review count
            // only exist on the place's own page, so we open it. Without this the row is a
            // directory listing, not a lead.
            if (includeDetails && !detailRouteReady) {
                // Detail pages are read entirely from the DOM, so images, video and
                // fonts are pure download cost. Blocking them cuts the compute per
                // place roughly in half. Installed only AFTER the feed was scraped,
                // because `imageUrl` comes from the feed's photos.
                await page.route('**/*', (route) => {
                    const t = route.request().resourceType();
                    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
                    return route.continue();
                }).catch(() => {});
                detailRouteReady = true;
            }

            if (includeDetails && cleaned.placeUrl) {
                const detail = await scrapeDetail(page, cleaned.placeUrl, log);
                if (detail) {
                    // Detail wins over the feed: its address is the full one (with postcode)
                    // and its website is the business site, not Google's booking redirect.
                    for (const [k, v] of Object.entries(detail)) {
                        if (v !== null && v !== '' && !(Array.isArray(v) && !v.length)) cleaned[k] = v;
                    }
                    detailHits++;
                } else {
                    detailMisses++;
                }
            }

            byKey.set(key, cleaned);
            // Pushed immediately: an aborted/timed-out run must still deliver
            // everything it already scraped.
            await Actor.pushData(cleaned);
        }
    },
    failedRequestHandler: async ({ request, log }, error) => {
        log.error(`Failed: ${request.url} - ${error.message}`);
        // Failures go to the key-value store, NEVER to the dataset: an error
        // row is not a business, it breaks the row schema for integrations and
        // would be billed as a delivered result.
        failures.push({
            searchQuery: request.userData.searchQuery,
            url: request.url,
            error: error.message,
            failedAt: new Date().toISOString(),
        });
    },
});

const requests = searchQueries.map((query) => {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.google.com/maps/search/${encodedQuery}/?hl=${language}`;
    return { url, userData: { searchQuery: query } };
});

await crawler.run(requests);

console.log(`Delivered ${byKey.size} businesses.`);
if (includeDetails) {
    console.log(`Detail pages: ${detailHits} enriched, ${detailMisses} unavailable.`);
} else {
    console.log('includeDetails was off: phone, opening hours and website are not available in listing-only mode.');
}

if (failures.length) {
    await Actor.setValue('FAILURES', failures);
    console.log(`${failures.length} search(es) failed - details in the FAILURES record of the key-value store.`);
}
console.log('Google Maps scraper finished.');
await Actor.exit();

async function scrollAndExtract(page, maxResults, log) {
    const allBusinesses = [];
    let previousCount = 0;
    let noNewResultsCount = 0;
    const MAX_STALE_SCROLLS = 5;

    while (allBusinesses.length < maxResults && noNewResultsCount < MAX_STALE_SCROLLS) {
        const newBusinesses = await page.evaluate(() => {
            const results = [];
            const feedEl = document.querySelector('div[role="feed"]');
            const container = feedEl || document;
            const cards = container.querySelectorAll('div[jsaction*="mouseover"]');

            for (const card of cards) {
                try {
                    const nameLink = card.querySelector('a[aria-label]');
                    const nameEl = card.querySelector('.fontHeadlineSmall, [class*="fontHeadlineSmall"]') ||
                                   card.querySelector('div[role="heading"]') ||
                                   card.querySelector('h3');
                    const businessName = nameLink?.getAttribute('aria-label') ||
                                         nameEl?.textContent?.trim() || '';
                    if (!businessName || businessName.length < 2) continue;

                    const placeUrl = nameLink?.href || '';

                    const ratingEl = card.querySelector('span[role="img"]');
                    const ratingText = ratingEl?.getAttribute('aria-label') || '';
                    const ratingMatch = ratingText.match(/([\d.]+)\s*stars?/i) ||
                                        ratingText.match(/([\d,]+)\s*estrellas?/i) ||
                                        (card.querySelector('span.MW4etd')?.textContent || '').match(/^([\d.,]+)$/);
                    const rating = ratingMatch ? parseFloat(String(ratingMatch[1]).replace(',', '.')) : null;
                    // Review count: aria-label first ("4.6 stars 1,234 Reviews"),
                    // then the count span "(1,234)", then any "(N)" in the card.
                    // Handles "1,234" and abbreviated "2.7K" / "1.2M".
                    const parseCount = (raw) => {
                        const m = raw.match(/(\d[\d,.]*)\s*([KkMm])?/);
                        if (!m) return null;
                        if (m[2]) {
                            const mult = m[2].toUpperCase() === 'K' ? 1e3 : 1e6;
                            return Math.round(parseFloat(m[1].replace(',', '.')) * mult);
                        }
                        return parseInt(m[1].replace(/[,.]/g, ''), 10);
                    };
                    const reviewMatch = ratingText.match(/([\d,.]+\s*[KkMm]?)\s*reviews?/i) ||
                                        ratingText.match(/([\d,.]+\s*[KkMm]?)\s*rese/i);
                    let reviewCount = reviewMatch ? parseCount(reviewMatch[1]) : null;
                    if (reviewCount === null) {
                        const countText = card.querySelector('span.UY7F9')?.textContent || '';
                        if (countText) reviewCount = parseCount(countText);
                    }
                    if (reviewCount === null && rating !== null) {
                        const m = (card.textContent || '').match(/\((\d[\d,.]*\s*[KkMm]?)\)/);
                        if (m) reviewCount = parseCount(m[1]);
                    }

                    // Structured info rows (.W4Efsd) hold "Category · Address" /
                    // "Open · Closes 9 PM" lines. Only LEAF rows: the outer
                    // wrapper concatenates inner rows WITHOUT separators, which
                    // is what used to leak the rating into `category` and a
                    // whole concatenated blob into `phone`.
                    const infoLines = [];
                    let infoEls = Array.from(card.querySelectorAll('.W4Efsd'))
                        .filter((el) => !el.querySelector('.W4Efsd'));
                    if (!infoEls.length) {
                        infoEls = Array.from(card.querySelectorAll('span, div[class*="fontBody"]'))
                            .filter((el) => !el.querySelector('span, div[class*="fontBody"]'));
                    }
                    for (const el of infoEls) {
                        const t = el.textContent?.trim();
                        if (t && t.length > 1 && t.length < 200 && t !== businessName) infoLines.push(t);
                    }

                    // Split each line on the middle-dot separator and classify.
                    const parts = [];
                    const seenParts = new Set();
                    for (const line of infoLines) {
                        for (const p of line.split(/\s*[·⋅]\s*/)) {
                            const tp = p.trim();
                            if (tp && !seenParts.has(tp)) { seenParts.add(tp); parts.push(tp); }
                        }
                    }
                    const isNoise = (s) =>
                        /^sponsored$/i.test(s) ||
                        /^ad$/i.test(s) ||
                        /^\d+(\.\d+)?$/.test(s) ||                 // bare rating "4.6"
                        /^\(?\d[\d,.]*\)$/.test(s) ||              // bare review count "(1,234)"
                        /^\d+(\.\d+)?\s*\(\d[\d,.]*\)/.test(s) ||  // merged "4.6(1,234)"
                        /\b(open|closed|opens|closes|hours|temporarily)\b/i.test(s) ||
                        /^(no reviews|new)$/i.test(s);

                    let category = '', address = '', phone = '', priceLevel = '';
                    for (const part of parts) {
                        if (isNoise(part)) continue;
                        if (/^[$€£¥]{1,4}$/.test(part) || /^\$\d[\d,]*([–-]\d[\d,]*)?\+?$/.test(part)) {
                            if (!priceLevel) priceLevel = part;
                            continue;
                        }
                        // Phone must look like a phone number on the RAW text.
                        // (The old code stripped letters BEFORE testing, so any
                        // text blob containing >=7 digits passed as a phone.)
                        if (!phone && /^\+?\(?\d[\d\s().\-]{5,18}\d\)?$/.test(part) && (part.match(/\d/g) || []).length >= 7) {
                            phone = part; continue;
                        }
                        if (!address && /\d/.test(part) && (part.includes(',') || /\b(st|ave|rd|blvd|dr|ln|way|ct|pl|hwy|suite|ste|unit)\b/i.test(part))) {
                            address = part; continue;
                        }
                        if (!category && part.length < 50 && !/\d/.test(part)) { category = part; continue; }
                        if (!address && part.includes(',') && part.length > 10) address = part;
                    }

                    const img = card.querySelector('img[src*="googleusercontent"], img[src*="maps"]');
                    const imageUrl = img?.src || '';

                    // The result card includes a "Website" button for businesses that have one — grab that external link.
                    const websiteLink = card.querySelector('a[data-value="Website"], a[aria-label*="Website" i], a[aria-label*="site" i]')
                        || [...card.querySelectorAll('a[href]')].find((a) => /^https?:\/\//.test(a.href) && !/\/maps\/|gstatic|schema\.org/.test(a.href));
                    let website = websiteLink?.href || '';
                    // Google sometimes wraps the website in a redirect (google.com/url?q=REAL_URL) — unwrap it.
                    if (/google\.[a-z.]+\/url/i.test(website)) {
                        const qm = website.match(/[?&](?:q|url)=([^&]+)/);
                        if (qm) website = decodeURIComponent(qm[1]);
                    }

                    results.push({
                        businessName, category, address, phone, priceLevel,
                        rating, reviewCount, placeUrl, imageUrl,
                        website, latitude: null, longitude: null, openingHours: null,
                    });
                } catch (e) { /* skip */ }
            }
            return results;
        });

        const seen = new Set(allBusinesses.map(b => `${b.businessName}|${b.address}`));
        for (const biz of newBusinesses) {
            const key = `${biz.businessName}|${biz.address}`;
            if (!seen.has(key) && biz.businessName) {
                seen.add(key);
                allBusinesses.push(biz);
            }
        }

        if (allBusinesses.length === previousCount) noNewResultsCount++;
        else noNewResultsCount = 0;
        previousCount = allBusinesses.length;

        log.info(`Loaded ${allBusinesses.length}/${maxResults} businesses...`);

        const endReached = await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes("You've reached the end of the list") ||
                   text.includes('No results found') ||
                   text.includes('No more results');
        });
        if (endReached) break;

        await page.evaluate(() => {
            const feed = document.querySelector('div[role="feed"]');
            if (feed) feed.scrollTop = feed.scrollHeight;
            else {
                const sc = document.querySelector('[class*="m6QErb"][class*="DxyBCb"]') ||
                           document.querySelector('.section-layout.section-scrollbox');
                if (sc) sc.scrollTop = sc.scrollHeight;
            }
        });
        await page.waitForTimeout(1500);
    }

    return allBusinesses.slice(0, maxResults);
}
