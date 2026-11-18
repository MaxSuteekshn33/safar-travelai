# Safar

A personal AI travel agent. You talk to it, by text or voice; it asks what it needs, searches flights and stays, researches the destination from recent travel blogs, and builds a live itinerary (day plan, flight and stay cards, running budget, map) beside the chat. It remembers you between trips, and it can book, change and cancel in simulation, always with your explicit confirmation.

## Setup

Requires Node 20.19 or newer.

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and paste your Anthropic API key after `ANTHROPIC_API_KEY=`. Then:

```bash
npm run db:push
npm run dev
```

Open http://localhost:3000.

`npm run db:push` creates the SQLite database at `prisma/dev.db`.

## Keys and what they unlock

| Variable | Needed | What it unlocks |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | The agent, and destination research from the live web. Without it the app loads but cannot reply. |
| `DUFFEL_ACCESS_TOKEN` | No | Flight search through Duffel. A `duffel_test_` token returns fictional test offers. Stay search too, if Duffel has enabled Stays on the account; otherwise stays use sample data. |
| `SAFAR_ACCESS_CODE` | No | When set, every page and API asks for this code first. Set it on any hosted copy. |
| `SAFAR_MODEL` | No | Model id. Default `claude-sonnet-5-5`. |
| `SAFAR_EFFORT` | No | Reasoning effort: `low` (default, fastest replies), `medium` or `high`. |
| `SAFAR_RESEARCH` | No | Set to `mock` to use offline sample notes instead of web research. |
| `SAFAR_OFFLINE` | No | Set to `1` to force every travel source to its mock, with no network calls. |
| `DATABASE_URL` | No | SQLite file location. Default `file:./dev.db` (in the `prisma` folder). |

What each source uses:

| Source | With only `ANTHROPIC_API_KEY` | With `DUFFEL_ACCESS_TOKEN` too |
| --- | --- | --- |
| Flights | Sample data | Duffel |
| Stays | Sample data | Duffel if Stays is enabled on the account, else sample data |
| Destination research | Live web search and page reading, with source links | Same |
| Weather | Open-Meteo (free, no key) | Same |
| Currency conversion | frankfurter.dev reference rates (free, no key) | Same |
| Transfers | Estimates | Same |
| Booking links | Pre-filled search URLs | Same |
| Bookings | Simulated | Simulated |

Anything from a mock is labelled "sample data" and Duffel test-mode offers are labelled "test data", in the panel and by the agent.

## How it works

- **Agent loop** (`src/lib/agent/loop.ts`): one streamed Messages API request per step. The model's tool calls are validated with Zod, run in parallel, and returned in a single message; the loop repeats until the model stops calling tools. History is append-only and assistant turns are stored exactly as received.
- **Tools** (`src/lib/agent/tools.ts`): `search_flights`, `search_stays`, `estimate_transfers`, `research_destination`, `get_weather`, `update_itinerary`, `update_traveler_profile`, `build_booking_links`, plus the booking tools `prepare_booking`, `get_bookings`, `request_cancellation` and `request_change`.
- **Providers** (`src/lib/providers/`): each external source is an interface with a mock implementation. `buildProviders()` is the one place that chooses between mock and real. Real adapters take an injectable `fetch`, so their tests run against recorded responses with no network.
- **Research** (`src/lib/providers/real/web-research.ts`): a separate model call uses Anthropic's server-side web search and web fetch tools to read travel blogs and submit findings. Every source link is then checked against the pages those tools actually returned. A recommendation is "verified" only if its page was fetched; a link the tools never returned is removed.
- **Itinerary**: one JSON document per conversation. Flights, stays and transfers are added by the id a search returned, so the model never retypes a price. The budget total is computed in code.
- **Memory** (`src/lib/agent/prompt.ts`, `src/lib/profile.ts`): the agent saves lasting facts and can correct or remove them. Each new conversation starts with the saved profile and a list of trips planned before. Everything can be edited or deleted at `/settings`.
- **Voice** (`src/lib/voice/`, `src/components/useVoice.ts`): the browser Web Speech API behind a `VoiceProvider` interface. Hold the mic to talk, or switch on hands-free. Replies are spoken a sentence at a time as they stream, and speaking over Safar stops it.
- **Bookings** (`src/lib/bookings/`): simulated. The agent can only propose a booking, change or cancellation, which shows a confirmation card. The action runs only from `POST /api/bookings` when you press the button; the agent has no tool that reaches it. Confirmations and vouchers are at `/trips`.
- **Export**: the Export PDF button opens a print-ready copy of the itinerary; choose "Save as PDF" in the print dialog.
- **Storage**: SQLite through Prisma (`prisma/schema.prisma`).

Two beta API features are switched on in `src/lib/agent/anthropic.ts`:

- **Server-side fallback**: if a safety classifier declines a request, the API retries it on a fallback model where that is allowed.
- **Thinking block binding set to `drop_block`**: if the prompt or tool list changes between app versions, old conversations keep working instead of failing.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app in development |
| `npm test` | Run all tests (no network, no API key) |
| `npm run typecheck` | Type-check |
| `npm run lint` | Lint |
| `npm run build` | Production build |
| `npm run db:push` | Create or update the local SQLite schema |

## Deploying to Vercel

The app deploys as a standard Next.js project. Set these in the Vercel project's environment variables, then redeploy:

- `ANTHROPIC_API_KEY` (required)
- `SAFAR_ACCESS_CODE` (strongly recommended: without it anyone with the URL can use the app and spend your API credit)
- `DUFFEL_ACCESS_TOKEN` (optional)

Do **not** set `DATABASE_URL` on Vercel.

**Data on Vercel is temporary.** Vercel's filesystem is read-only except `/tmp`, so the hosted copy keeps its SQLite database there and creates its tables at startup. That data is lost whenever Vercel recycles the server, and is not shared if Vercel runs more than one instance, so a conversation can occasionally reset mid-way. The app shows a banner saying so and tells you when a conversation was lost. Making hosted data permanent needs a hosted database, which is not set up.

It is also worth setting a monthly spend limit on the API key in the Anthropic Console.

## Known limitations

- **Bookings are simulated.** No reservation is made and no payment is taken, anywhere. Fare rules come from the offer where the provider supplies them, and from simple built-in rules otherwise.
- **Duffel test mode returns fictional offers.** With a `duffel_test_` token the search is real but the results are test data: usually one or two offers per route, often from "Duffel Airways", priced in USD and converted. Real fares need a live Duffel token.
- **Duffel Stays has never been run against a live account.** Stays must be enabled by Duffel. The adapter is written from Duffel's documentation and tested against a documented-shape response; on accounts without Stays it falls back to sample data, which is what has been tested for real.
- **Sample stays are fictional.** Names end in "(sample)". For cities outside the built-in list of 28 they have generic areas and no map position.
- **Research takes 30 to 60 seconds** and costs a few cents per destination; results are cached for an hour. It reads what search returns, so quality varies, and blog prices and hours can be out of date. Destination ideas the agent offers before researching come from the model's general knowledge and are said to be unchecked.
- **Voice depends on the browser.** Speech recognition works in Chrome, Edge and Safari, not Firefox, and needs an internet connection in Chrome. Hands-free interruption filters out Safar's own voice by comparing words, which is imperfect on loudspeakers; headphones work best. Voice was verified with a simulated speech engine, not with a real microphone.
- **Weather beyond 16 days is not a forecast.** For dates further out, Safar shows the recorded weather on the same dates last year and says so.
- **Converted prices are indicative.** The original amount is kept in the offer's notes.
- **Booking links** were checked in a browser on 18 Nov 2026 with a Delhi to Goa return for two adults: Skyscanner, MakeMyTrip flights, ixigo and Airbnb opened the right route, dates and travellers. One-way and with-children variants were not opened. MakeMyTrip hotels is pre-filled only for Indian cities in the built-in list (checked on Goa and Jaipur). These URL formats are undocumented and can change.
- **PDF export uses the browser's print dialog** rather than generating a file directly, and leaves out the map.
- **Map pins are approximate.** Coordinates come from the sample data or the model.
- **Memory is the profile plus a list of earlier trip titles and dates.** A new conversation does not see the text of old conversations.
- **Single user.** One profile and one set of trips per copy of the app; the access code is shared, not per person.
