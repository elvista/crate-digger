# Better cosine.club ↔ Spotify matching

## Goal

**Prioritize recall on both services. Every song search should work toward 50 unique, playable Spotify tracks, ranked strongest to weakest.** More plausible matches are preferable to an unnecessarily short queue, even when some matches are imperfect.

Use permissive retrieval and automatic inclusion of plausible matches. Confidence controls ordering and labeling, rather than blocking every uncertain result. Do not require manual confirmation before filling the queue. Keep exact recording identity distinct from a useful approximate match.

The target is **50 resolved Spotify songs, not 50 cosine candidates searched**. Continue expanding and resolving candidates until 50 are available, the search space is exhausted, or a provider cooldown pauses the job. Show partial results immediately and continue toward 50 in the background. Never pad with duplicate releases or unrelated tracks just to reach the count.

There are two separate matching problems:

1. Spotify source song → the corresponding cosine.club recording.
2. cosine.club recommended recording → a playable Spotify recording.

Measure and report these independently. A failed bulk lookup, an ambiguous recording, a market restriction, and a rate limit are different outcomes.

## Existing examples and acceptance cases

| Source | Evidence from testing | Required behavior |
| --- | --- | --- |
| Fela Kuti — Water No Get Enemy | Dedicated cosine endpoint returned 50 neighbors; 24 matched to Spotify in that run. Different ISRCs on otherwise matching reissues caused unnecessary rejection. | Accept compatible reissues; retain duration/version distinctions between the 11:00 and 9:51 recordings. |
| Bon Iver — The Wolves (Act I and II) | Current cosine bulk and individual searches did not resolve the seed. | Try title/credit variants, including Act I & II, and plausible alternate recordings. An approximate seed may be used automatically with a visible label. If no plausible work match exists, show an explicit broader artist-based fallback rather than claiming exact audio similarity. Current searches do not establish absolute catalog absence. |
| Disclosure — Latch | cosine credits Disclosure feat. Sam Smith; Spotify credits Disclosure and Sam Smith separately. A local test resolved 39 of 50 recommendation candidates. | Resolve the original across credit formats. Keep Radio Edit and Jamie Jones Remix as separate versions. |
| Sammy Virji — Peaches | Searches identified Peach by salute and Sammy Virji. cosine search found recording 1245384 although its bulk lookup failed. Spotify resolution of the recommendation batch was interrupted by a rate limit. | Automatically use the likely intended Peach when title similarity and artist overlap support it, show the corrected full credit, and recover its cosine ID through individual search. Do not claim a verified recommendation count yet. |

These counts are observed runs, not guaranteed future results or overall accuracy measurements.

## 1. Protect the API budget first

- Honor Spotify's Retry-After across all search jobs sharing the app credentials. Persist the cooldown so another request or server instance cannot immediately retry.
- Cache successful identity mappings durably: cosine ID, Spotify ID/URI, artist credits, full title, version, market, evidence, and verification time.
- Reuse confirmed mappings before searching. Cache raw search results initially for 24 hours; cache unresolved searches briefly, initially 30 minutes. Do not cache rate limits as missing tracks.
- Resolve an initial batch of 10–15 uncached candidates for a fast first response, then continue automatically until 50 unique playable Spotify tracks are resolved. Do not wait for the listener to exhaust the initial batch.
- Use one coordinated Spotify search queue, a configurable request budget, and low concurrency. Keep partial matches when a provider pauses; resume from the remaining candidates instead of restarting.
- Show an explicit paused state and retry time. Do not automatically keep trying during the cooldown.

## 2. Represent song identity and recording identity separately

Store both the original metadata and a normalized representation:

- **Song/work:** base title plus structured artist credits.
- **Recording/version:** remix or edit name, remixer, live/acoustic/instrumental status, duration, ISRC when available, and provider IDs.

Normalize accents, case, punctuation, spacing, and explicit feat./ft./featuring markers. Compare collaborators as structured credits where available, rather than only comparing text before the first comma. Preserve artist names containing “&”; do not blindly split band names.

Keep meaningful subtitles such as “Act I and II.” Normalize “and” versus “&” in that context. Remove version suffixes only to broaden a search, while retaining them for validation.

Allow fuzzy title and credit matching, including Peaches → Peach when artist overlap supports it. Automatically use a strong likely correction and show “Using Peach — salute, Sammy Virji.” Keep a way to change the interpretation; do not label the correction as an exact string match.

## 3. Use a bounded search ladder

### Spotify seed → cosine.club

1. Reuse a verified mapping if present.
2. Try the bulk lookup for efficient playlist processing.
3. On a miss, search individually using full title plus primary artist.
4. Try a normalized title and alternate credited artist, especially when the selected artist is a collaborator rather than the first credit.
5. Search base title plus artist, alternate versions, and fuzzy title variants; inspect additional pages where supported.
6. Rank plausible seed matches and automatically use the best. For a close tie between versions of the same work, allow a small blend of their neighbor pools, labeled as approximate seed matching. Prefer an exact mapping when one exists; do not blend unrelated songs.
7. If no plausible work match exists, use an explicitly labeled broader fallback based on the seed artist's available recordings, then their cosine neighbors. This is a lower-confidence discovery route, not evidence that cosine analyzed the requested song.

Evaluate all returned candidates, rather than choosing the first acceptable result. A bulk miss is not a catalog miss. Start with three fallback searches per unresolved seed; if the queue remains below 50, schedule additional variants within the shared provider budget. Process all unresolved playlist seeds fairly rather than permanently ignoring those after the first eight.

### cosine.club recommendation → Spotify

1. Reuse a verified mapping if present.
2. Search full title plus the most useful artist credit.
3. If no confident result appears, search base title plus artist using less restrictive quoting.
4. Try collaborators, unquoted text, fuzzy title variants, and title-only retrieval followed by artist ranking.
5. Include plausible original/edit/remix alternatives when the analyzed recording is unavailable. Rank these below stronger direct matches and keep their version labels.
6. Retain plausible ambiguous matches automatically at lower rank; do not require a review step before they can enter the queue.

Stop searching a candidate once a useful mapping is found. Start with up to three searches per unresolved candidate, then revisit promising misses if fewer than 50 tracks have resolved. Use cheaper cached matches and fresh candidates before spending many calls on one difficult recording.

### Expand until 50 playable tracks exist

- Request the largest verified cosine neighbor pool, initially 50 per resolved seed. Use supported pagination or higher limits only after checking the endpoint's actual behavior.
- If 50 candidates yield only 24 Spotify matches, fetch more candidates rather than finishing at 24. Expand other plausible seed recordings and, where needed, neighbors of the strongest first-hop recommendations.
- Deduplicate cosine IDs before lookup and Spotify recording identities after resolution. Distinct remixes and edits may count separately; duplicate album/compilation releases of the same recording count once.
- Give direct seed neighbors priority. Mark second-hop or broader artist-based discoveries and rank them lower unless stronger direct evidence is available. Cosine scores from different seed calls are not assumed to be calibrated against one another.
- Relax artist-diversity caps and unnecessary rejection filters when they prevent reaching 50. Do not discard a valid match solely because its artist already has three tracks in the queue.
- Target 50 eligible tracks after source-song, duplicate, availability, and already-reviewed filtering. Expand further to replace filtered results.
- Persist a resumable job cursor. A request/time budget yields and schedules more work; it does not quietly mark a short queue complete. When the available search space really ends, show the actual count and reason.

## 4. Rank candidates with explicit evidence

Use a transparent scoring function initially, with thresholds calibrated against labeled fixtures rather than presented as probabilities:

- Strong agreement: known provider mapping, matching ISRC where both providers supply it, full title, artist-credit overlap, explicit version/remixer match.
- Supporting evidence: compatible duration, album/release metadata, known reissue relationship, and market playability.
- Strong contradictions: unrelated artist, different remix name, original versus live/acoustic/cover, or a large unexplained duration difference.

Compare the best candidate with the runner-up. A plausible ambiguous tie stays eligible at lower confidence; select the strongest candidate automatically and offer correction inline. Missing duration or ISRC is unknown evidence, not a mismatch.

Use duration differences as a soft ranking penalty. Close durations support a direct match; larger gaps can still produce useful edits or remixes and should not impose a global rejection threshold. Different ISRCs should trigger evaluation of reissue evidence rather than rejection of the entire result group.

Prefer an available playable release of a confirmed recording. Do not collapse all releases into one unresolved group because an outlier edition has different metadata.

## 5. Keep versions useful and honest

Assign each result one of these states:

- **Confirmed recording:** confidently matched to the recording cosine analyzed.
- **Related version:** the same song in another original/edit/remix version, explicitly labeled.
- **Approximate match:** plausible identity with conflicting or insufficient evidence; eligible automatically and labeled for optional correction.
- **Unresolved:** bounded searches completed without a usable match.
- **Paused / provider error:** lookup did not complete; it is not an unresolved recording.

Queue confirmed recordings, related versions, and plausible approximate matches automatically, strongest first. Keep a soft per-song version limit for variety, and relax it when useful distinct versions help fill the 50-track queue. Never transfer the analyzed recording's cosine similarity score onto an alternate remix or edit.

For an unresolved source recording, automatically use the strongest plausible alternate with a visible explanation. An unrelated song must not be passed off as a recording match; any broader discovery fallback needs its own label.

### Final ranking

Rank using both **musical relevance to the source** and **confidence in the provider mapping**. Prefer direct cosine neighbors with strong identity matches, then plausible direct matches/related versions, followed by second-hop and broader fallback discoveries. Within each tier, use available cosine rank/score, seed agreement, and mapping evidence. Keep cosine similarity, mapping confidence, and fallback provenance as separate fields. Never invent cosine scores for alternate recordings.

Return the best 50 resolved tracks in descending rank. Re-rank as stronger background results arrive while keeping the currently playing card stable. User correction is optional, not a gate.

## 6. Make matching measurable and correctable

- Add an offline fixture suite for the four examples above, featured credits, collaborator order, punctuation, reissues, remixes, radio edits, and live/acoustic negatives.
- Label expected identities manually. Include near misses to measure the error tradeoff. Some plausible approximate matches are acceptable; unrelated identities and misleading exact-match labels remain failures.
- Primary metrics: percentage of searches reaching 50 playable tracks, final unique playable count, time to first batch, time to 50, and source resolution rate. Track exact/approximate/related-version proportions, obviously unrelated results, optional user corrections, and requests per resolved track as supporting metrics.
- Record concise match reasons and search-stage outcomes without credentials or private playlist contents.
- Let users correct a borderline mapping. Persist the confirmed choice with its version identity and revalidate availability when reused.
- Display a compact generation summary: seeds resolved, candidates found, playable recordings, related versions, unresolved tracks, and paused lookups.

## Delivery order

1. **Budget and fixtures:** durable mapping/search cache, shared cooldown, partial-result persistence, baseline fixtures and counters.
2. **Seed resolution:** structured credits, normalized title variants, bulk-to-individual fallback, ranked candidate selection. Verify Latch and Peach; try approximate and labeled broader fallback paths for Wolves if its exact recording remains unresolved.
3. **Spotify resolution:** bounded fallback searches, reissue selection, version-aware confidence and ambiguity handling. Recheck Fela after the cooldown.
4. **Queue and review:** automatic expansion toward 50, descending relevance ranking, related-version controls, optional corrections, and clear progress/counts.

Before release, all identity/provenance assertions must pass, including correct labeling of approximate matches. Re-run the four live examples once Spotify permits requests and target **50 unique playable Spotify tracks for each**, strongest first. If an example cannot reach 50, record the exhausted search stages or provider restriction and retain a reproducible failure case. Measure coverage and request cost against the baseline; imperfect plausible matches are an accepted tradeoff for higher coverage. Do not claim 50 when only 50 candidates were inspected, or promise catalog coverage a provider cannot supply.

## Implementation status

Implemented locally: permissive seed and Spotify matching, automatic typo/credit recovery, labeled artist and second-hop fallback, expansion toward 50, descending ranking, private resumable jobs, automatic continuation while the page is open, persisted provider cooldowns and request budgets, durable search/mapping caches, and optional recording correction. Jobs resume on reopening the session; they do not run unattended after the browser closes. Safety bounds are 20 second-hop hubs and 1,500 candidates, with shortfall explanations. User-confirmed and automatic mappings currently both expire after 24 hours. Live validation of all four examples remains dependent on Spotify's earlier cooldown ending.
