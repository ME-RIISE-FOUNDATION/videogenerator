/**
 * newsFetcher.js
 *
 * Fetch news headlines from Google News's key-free RSS endpoint and compose
 * them into script text in the exact paragraph shape parseScript() expects.
 * No XML parsing library — regex + string ops only.
 */

const RSS_TIMEOUT_MS = 8_000;
const USER_AGENT = 'highlight-reel-studio/1.0 (local desktop app)';
const MAX_HEADLINES = 6;

function buildFeedUrl(topic) {
  const params = new URLSearchParams({ hl: 'en-IN', gl: 'IN', ceid: 'IN:en' });
  if (topic && topic.trim()) {
    params.set('q', topic.trim());
    return `https://news.google.com/rss/search?${params}`;
  }
  return `https://news.google.com/rss?${params}`;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Description is CDATA-wrapped; strip the CDATA markers before the generic
// tag-stripping regex, or a description with no embedded tag makes the
// naive `<[^>]*>` replace swallow the whole CDATA span as one "tag".
function stripTags(str) {
  const noCdata = str.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
  return decodeEntities(noCdata.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Google News titles are "Headline - Source Name" — drop the trailing source.
function cleanHeadline(rawTitle) {
  const text = stripTags(rawTitle);
  const match = /^(.*)\s[-–]\s[^-–]+$/.exec(text);
  return (match ? match[1] : text).trim();
}

function extractItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < MAX_HEADLINES) {
    const block = m[1];
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(block);
    if (!titleMatch) continue;
    const headline = cleanHeadline(titleMatch[1]);
    if (!headline) continue;

    // Google's <description> is almost always the same headline re-wrapped
    // in an <a> + a source <font> tag — only keep it if it adds real content.
    const descMatch = /<description>([\s\S]*?)<\/description>/.exec(block);
    let snippet = descMatch ? stripTags(descMatch[1]) : '';
    if (!snippet || snippet.toLowerCase().startsWith(headline.toLowerCase().slice(0, 20))) {
      snippet = '';
    }
    items.push({ headline, snippet: snippet.slice(0, 200) });
  }
  return items;
}

/**
 * Fetch today's India headlines (or headlines for a topic) from Google
 * News's key-free RSS feed and compose them into script text in the exact
 * paragraph shape parseScript() expects (title line, blank line, then one
 * blank-line-separated paragraph per headline).
 *
 * @param {{topic?: string}} options
 * @returns {Promise<string>} Composed script text.
 * @throws {Error} On network failure or zero headlines — caller's existing
 *   catch-all error handling covers this (no new error plumbing needed).
 */
export async function fetchNewsScript({ topic = '' } = {}) {
  const url = buildFeedUrl(topic);
  let xml;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google News returned HTTP ${response.status}`);
    xml = await response.text();
  } catch (err) {
    throw new Error(`Could not reach Google News (${err.message}). Check your internet connection and try again.`);
  }

  const items = extractItems(xml);
  if (items.length === 0) {
    throw new Error(
      topic.trim()
        ? `No headlines found for "${topic.trim()}" — try a broader topic or leave it blank for top headlines.`
        : 'No headlines were returned — Google News may be unreachable right now.'
    );
  }

  const titleLine = topic.trim()
    ? topic.trim().slice(0, 60).split(' ').slice(0, 8).join(' ')
    : 'Top Headlines Today';
  const scenes = items.map((it) => (it.snippet ? `${it.headline}. ${it.snippet}` : `${it.headline}.`));
  return `${titleLine}\n\n${scenes.join('\n\n')}`;
}
