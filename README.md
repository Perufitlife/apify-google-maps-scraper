# Google Maps Business Scraper -- Extract Local Business Data at Scale

Turn any Google Maps search into a structured database of local businesses. Extract names, addresses, phone numbers, websites, ratings, review counts, GPS coordinates, and more -- all from a simple keyword search. Whether you are building prospect lists, analyzing markets, or powering a lead generation pipeline, this scraper delivers clean, export-ready business data in seconds.

Stop manually copying business information from Google Maps. Automate the entire process and focus on closing deals instead.

## What data can you extract?

| Field | Type | Description |
|-------|------|-------------|
| `searchQuery` | string | The original search query used to find this business |
| `businessName` | string | Official name of the business as listed on Google Maps |
| `category` | string | Business category (e.g., "Restaurant", "Dentist", "Plumber") |
| `address` | string | Full street address including city, state, and zip code |
| `phone` | string | Primary phone number, in E.164 form (`+14807196994`) — ready to dial or import into a CRM without cleanup |
| `website` | string | Business website URL |
| `rating` | number | Average star rating from 1.0 to 5.0 |
| `reviewCount` | integer | Total number of Google reviews |
| `priceLevel` | string | Price level indicator ($, $$, $$$, or $$$$) |
| `openingHours` | object | Business hours broken down by day of the week |
| `latitude` | number | GPS latitude coordinate |
| `longitude` | number | GPS longitude coordinate |
| `placeUrl` | string | Direct Google Maps link to the business listing |
| `imageUrl` | string | URL of the main business photo |
| `scrapedAt` | string | ISO 8601 timestamp of when the data was extracted |

## Use cases

- **Lead generation and sales prospecting** -- Build targeted contact lists of local businesses by industry and geography. Feed results directly into your CRM or outreach tools.
- **Local SEO and competitive analysis** -- Benchmark your business against competitors in any area. Compare ratings, review volumes, categories, and price levels across an entire market.
- **Market research and site selection** -- Map business density, pricing trends, and competitive intensity for any location. Ideal for real estate investors, franchise operators, and retail strategists.
- **Data enrichment for existing databases** -- Enrich your existing business records with fresh phone numbers, websites, ratings, and coordinates from Google Maps.
- **Monitoring and change detection** -- Schedule recurring runs to track new businesses appearing in a market, rating changes, or closures over time.

## Finding prospects by what a business is missing

If you sell websites, SEO, reputation management or ads to local businesses, the value of a Maps export is not the list — it is the three columns that expose a gap. The Actor extracts everything and filters nothing, so you sort the dataset afterwards.

> **These filters depend on `includeDetails` being on (it is by default).** Google's results feed carries only the name, category, a partial address and the rating. `phone`, `openingHours`, `reviewCount` and the business's real website exist solely on each place's own page, which the Actor opens for you. Switch `includeDetails` off and those columns come back empty — so an "empty `website`" would mean *not collected*, not *no website*, and every filter below would be wrong.

- **No website at all** — with `includeDetails` on, `website` is read from the business's own Maps page, so an empty string means the business genuinely has no site listed. Filter for empty and you have every business in the category that cannot be found anywhere except Maps. This is the shortest, warmest list a web designer can build, and the businesses on it are almost always reachable by phone rather than email.
- **Barely any reviews** — sort `reviewCount` ascending among businesses that *do* have a website. A real business with a site, decent `rating` and 4 reviews is not failing; it is simply not asking. That is the reputation-management pitch, and the number in the column is the pitch itself.
- **Rating below the local average** — pull the whole category for a city, take the mean `rating`, and the businesses under it are the ones with a problem they already know about. The category average from the same run is what makes the outreach specific instead of generic.
- **Weak or dated web presence** — set `includeWebsite: true` and each listing's site is visited for emails and social links. Businesses whose site yields no email and no social profiles are, in practice, the ones running a stale brochure page.

One caveat worth knowing before you build a campaign on it: `reviewCount` and `rating` are point-in-time values scraped during that run. Re-running the same query on a schedule and diffing the two columns is what turns them into a signal — new businesses appearing, ratings sliding, review counts stalling — rather than a snapshot.

## Finding web design clients: businesses with no site

A business with a Google listing and no website is the shortest pitch a web designer will ever make: they already have customers, they already have reviews, and there is nothing to redesign — only something to build.

Run the category and the city, then filter `website` for an empty string. Because the Actor opens each place's own page, an empty `website` means Google has no site on file for that business, not that the field went uncollected.

The trades convert best because the buying decision is one person: plumbers, roofers, HVAC contractors, electricians, landscapers, auto repair shops. A search like `plumbers in Tucson, AZ` typically returns a mix where the ones without a site are also the ones with a `phone` and a healthy `rating` — a working business that is simply invisible outside Maps.

Pair the empty `website` with `reviewCount` above 20 and you have filtered out the dormant listings: someone left those reviews, so someone is answering the phone.

## Med spas, salons and the booking-link trap

Appointment-driven businesses look like they have a website when they do not. Run `med spas in Austin, TX` or `hair salons in Miami, FL` and read the `website` column carefully — a good share of it points at a booking platform, not at the business:

```
https://www.zocdoc.com/practice/...?utm_source=reservewithgoogle
https://booksy.com/en-us/...
https://www.vagaro.com/...
```

That is Google's "Reserve with Google" link occupying the website slot. The business is renting a page on someone else's domain, which is a different pitch from "you have no website" and a better one: they already pay for online booking, they just have no site of their own.

A one-line filter separates them from real domains: keep the rows whose `website` host is a third-party platform (`zocdoc`, `booksy`, `vagaro`, `squareup`, `fresha`, `mindbodyonline`), and drop the rest. Combine with `openingHours` to know when to call.

## Territory planning and ZIP-level exports

Every row carries `latitude`, `longitude` and a full `address` with its postal code, so the export doubles as a map layer rather than just a call list.

Pass several queries in one run — `dentists in Mesa, AZ`, `dentists in Chandler, AZ`, `dentists in Gilbert, AZ` — and the `searchQuery` field on each row tells you which query produced it. That is what lets you split a metro into territories, count businesses per ZIP, or hand a rep a defined patch without a second pass.

For density work, plot `latitude`/`longitude` directly in a mapping tool. For quota setting, group by the postal code at the end of `address`. The coordinates come from Google's own place record, so they land on the building rather than on a geocoded guess from the street string.

## Reputation management: rating versus review volume

Two columns tell different stories, and the pitch depends on which one is weak.

A **low `rating`** is a business that knows it has a problem. Pull an entire category for a city, average the `rating` column, and the ones below the average are already living with the consequences. Quoting their number against the local average is what makes the first line of an email specific.

A **low `reviewCount` with a high `rating`** is the opposite: a business doing good work that never asks. A dentist at 4.9 with 11 reviews sitting next to competitors at 4.6 with 900 is losing the click on volume alone, and that is a review-generation sale, not a reputation-repair one.

`reviewCount` comes from the place's own page, so it is the full number rather than the abbreviated one shown in the results list. Re-run the same query weekly and diff the column to see who is actively collecting reviews and who has stalled.

## Auditing Google Business Profiles

If you sell profile optimization, the gaps are visible straight from the export. A row missing `website` or with an empty `openingHours` is a profile that was claimed once and never finished — and an incomplete profile ranks below a complete one in Maps.

`openingHours` is the most telling of the two: a business that never entered its hours is one that does not treat the listing as a channel. Sort by how many of those two fields are empty and you have a prioritized audit list before you speak to anyone.

(`priceLevel` only exists for categories where Google shows a price band, such as restaurants and bars. It comes back empty for most service businesses, so treat it as a bonus column rather than a signal.)

One honest limit: this Actor returns what Google publishes. It does not extract email addresses — those live on the business's own site. If email is what your campaign runs on, use [Google Maps Leads with Emails](https://apify.com/renzomacar/google-maps-leads-with-emails), which visits each site found here and pulls the contact details from it.

## Input parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `searchQueries` | array of strings | Yes | -- | Search queries to run on Google Maps (e.g., "dentists in Miami FL", "coffee shops near Times Square NYC") |
| `maxResultsPerQuery` | integer | No | 100 | Maximum number of businesses to extract per query (1-500) |
| `language` | string | No | "en" | Language code for results (e.g., "en", "es", "fr", "de") |
| `maxConcurrency` | integer | No | 3 | Number of browser pages to run in parallel (1-10). Lower values reduce the risk of rate limiting. |
| `includeWebsite` | boolean | No | false | Visit each business website to extract additional data such as emails and social media links. Increases run time. |

### `includeDetails` (default: `true`)

Google's results feed is a directory listing: name, category, a partial address, a rating. Everything an outreach campaign actually runs on — the phone number, the opening hours, the review count and the business's own website rather than Google's booking redirect — lives on each place's individual page.

With `includeDetails` on, the Actor opens those pages. On a 12-result run that is the difference between:

| field | listing only | with details |
|---|---|---|
| `phone` | empty | filled |
| `website` | 1 in 4, often a booking redirect | the real site |
| `reviewCount` | empty | filled |
| `openingHours` | empty | filled |
| `address` | street only | full, with postcode |

It costs roughly one extra page view per business, so a listing-only sweep is faster and cheaper. Turn it off when you only need names, ratings and coordinates.

## Example output

```json
{
    "searchQuery": "dentists in Scottsdale, AZ",
    "businessName": "Dentistry of Old Town Scottsdale",
    "category": "Dentist",
    "address": "7449 E Osborn Rd #4, Scottsdale, AZ 85251",
    "phone": "+14807196994",
    "website": "https://www.dentistryofoldtownscottsdale.com/",
    "rating": 4.8,
    "reviewCount": 973,
    "priceLevel": "",
    "openingHours": [
        "Monday: 7 AM–4 PM",
        "Tuesday: 7 AM–4 PM",
        "Saturday: Closed"
    ],
    "latitude": 33.4871947,
    "longitude": -111.9206536,
    "placeUrl": "https://www.google.com/maps/place/Dentistry+of+Old+Town+Scottsdale/...",
    "imageUrl": "https://lh5.googleusercontent.com/p/AF1QipN...",
    "scrapedAt": "2026-03-01T12:00:00.000Z"
}
```

## How much does it cost?

This actor uses a **pay-per-result** pricing model, so you only pay for the data you actually receive:

- **$0.004 per business** extracted ($4.00 per 1,000 businesses)
- A typical run scraping 100 businesses from a single search query costs approximately **$0.40**
- Scraping 1,000 businesses costs approximately **$4.00**
- Scraping 10,000 businesses across multiple queries costs approximately **$40.00**

There are no monthly fees or commitments. You only pay for the data you extract.

## Tips and tricks

- **Use specific, location-based queries for the best results.** A query like "Italian restaurants in Manhattan, NY" will return more relevant results than a generic "restaurants in New York." Google Maps search results are inherently location-scoped, so the more specific you are, the better the data quality.
- **Google Maps typically returns up to 120 results per search.** If you need broader coverage of a large area, break your search into multiple targeted queries (e.g., by neighborhood, zip code, or subcategory) rather than relying on a single broad query.
- **Keep concurrency between 1 and 3 for reliable results.** Higher concurrency speeds up execution but increases the risk of Google rate-limiting your requests. For large-scale projects, it is better to run multiple smaller batches.
- **Schedule recurring runs for market monitoring.** Business data on Google Maps does not change as frequently as product prices or reviews. Weekly or monthly runs are typically sufficient for monitoring purposes.



## FAQ

### How do I scrape business data from Google Maps?
Enter one or more search queries like "dentists in Miami FL" or "coffee shops near Times Square NYC", set how many results you want per query, and run the actor. It returns names, addresses, phone numbers, websites, ratings, review counts, GPS coordinates, and opening hours as clean JSON, CSV, or Excel.

### Do I need an API key?
No. There is no Google Maps API key, no Google Cloud billing account, and no login to set up. You just need an Apify account and the actor handles the rest, including proxy rotation.

### Why use this instead of the official Google Places API?
The official Google Places API requires a billing-enabled Google Cloud project, caps results, charges per request across multiple endpoints to assemble a full profile, and limits how you may store and display the data. This actor returns the full business record in one call, has no per-field upcharges, and exports straight to a spreadsheet or CRM.

### Is there a Google Maps API alternative for bulk lead lists?
Yes -- this actor is built exactly for that. Instead of stitching together Places API "Nearby Search" and "Place Details" calls with quota caps, you pass a list of queries and get up to 500 export-ready businesses per query with phone, website, and rating included.

### How fresh is the data?
Every record is scraped live from Google Maps at run time and stamped with `scrapedAt`. Business listings change slowly, so a weekly or monthly scheduled run is usually enough to keep a market database current.

### Can I use the scraped data for cold outreach and lead generation?
Yes -- this is the most common use case. You get phone numbers and websites you can push into a CRM or feed into the Website Contact & Email Finder to enrich with emails before reaching out. You are responsible for complying with Google's terms, local marketing/anti-spam laws, and how you use the data.

## Automate it

Add this actor to an Apify **Schedule** to re-scrape your target markets daily, weekly, or monthly and track new businesses, rating changes, and closures over time -- recurring runs keep your lead database fresh automatically. Connect the dataset to **Make, n8n, Zapier, Google Sheets, Slack, or a webhook/CRM** through Apify integrations so new businesses flow straight into your pipeline without manual exports.

## Related actors

- [Website Contact & Email Finder](https://apify.com/renzomacar/website-contact-finder) -- Crawl the websites you extract here to find emails, phones, and social profiles for outreach.
- [Google Maps Reviews Scraper](https://apify.com/renzomacar/google-maps-reviews) -- Pull every review and owner response for the businesses you discover.
- [Google Maps Leads with Emails](https://apify.com/renzomacar/google-maps-leads-with-emails) -- Get Google Maps businesses already enriched with email addresses in one step.
- [Healthcare Provider Leads](https://apify.com/renzomacar/healthcare-provider-leads) -- Targeted lead lists for medical, dental, and clinic verticals.
- [Yelp Businesses Scraper](https://apify.com/renzomacar/yelp-businesses) -- Cross-reference local businesses on Yelp for broader market coverage.

## Using AI to write your outreach / posts / replies?

If you use this scraped data to inform AI-generated cold emails, LinkedIn posts, Reddit replies, etc., **modern detectors are catching on**. Em-dashes, "delve", parallel bullets, and 9 other patterns get accounts flagged or callout-replied. Built [**aitells.vercel.app**](https://aitells.vercel.app) after my own reddit account got 2 "all AI generated" callouts in one day. Free detector + $19 lifetime rewriter that matches your voice.



## Related scrapers

- [Google Maps Reviews Scraper](https://apify.com/renzomacar/google-maps-reviews) -- Extract all reviews, ratings, and owner responses for businesses you discover with this scraper.
- [Website Contact & Email Finder](https://apify.com/renzomacar/website-contact-finder) -- Crawl the websites extracted from Google Maps to find emails, phone numbers, social media profiles, and technology stacks.
