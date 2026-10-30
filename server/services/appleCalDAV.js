const axios = require('axios');
const crypto = require('crypto');
const ICAL = require('ical.js');
const { XMLParser } = require('fast-xml-parser');

const CALDAV_BASE = 'https://caldav.icloud.com';

// CalDAV responses are WebDAV "multistatus" XML envelopes whose <calendar-data>
// elements contain an iCalendar (ICS) text payload. We use a real XML parser for
// the envelope (it transparently handles CDATA, XML entities, and namespaces) and
// hand the extracted ICS text to ical.js, which is responsible for parsing the
// iCalendar payload itself.
const xmlParser = new XMLParser({
  removeNSPrefix: true,   // collapse d:/c:/cs:/ical: prefixes
  ignoreAttributes: false, // need attributes (e.g. comp[name="VEVENT"])
  attributeNamePrefix: '@_',
  parseTagValue: false,    // keep text as strings (colors, ctags, hrefs)
  trimValues: true,
});

// ---------------------------------------------------------------------------
// Outbound CalDAV request bodies
//
// Every request body lives here so the wire format is in one place instead of
// being scattered through the request functions. JavaScript has no `static final`,
// so this is a frozen class with static fields — the closest equivalent: the
// values cannot be reassigned, and strings are immutable already.
//
// CALENDAR_QUERY is the one exception to "static string": a calendar-query REPORT
// must carry a concrete time-range, so it is a builder.
// ---------------------------------------------------------------------------
class ICLOUD_XML_MESSAGE {
  // PROPFIND Depth:0 against the service root -> current-user-principal href.
  static CURRENT_USER_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

  // PROPFIND Depth:0 against the principal -> calendar-home-set href.
  static CALENDAR_HOME_SET = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`;

  // PROPFIND Depth:1 against the calendar home -> one entry per collection.
  // cs:source is required: it is the only way a subscription's upstream feed URL
  // becomes discoverable. Without it, subscriptions look like empty calendars.
  static CALENDAR_LIST = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <ical:calendar-color />
    <cs:getctag />
    <cs:source />
    <c:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;

  // PROPFIND Depth:0 against a single collection -> is it a subscription, and
  // where does its feed live? Kept minimal so the probe stays cheap.
  static COLLECTION_SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:resourcetype />
    <cs:source />
  </d:prop>
</d:propfind>`;

  // REPORT against a calendar collection -> etag + ICS payload per event that
  // overlaps the window. Both bounds are UTC basic-format (YYYYMMDDTHHMMSSZ).
  static CALENDAR_QUERY(startUtc, endUtc) {
    return `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startUtc}" end="${endUtc}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
  }
}

Object.freeze(ICLOUD_XML_MESSAGE);

function buildAuthHeader(appleId, appPassword) {
  return 'Basic ' + Buffer.from(`${appleId}:${appPassword}`).toString('base64');
}

// ---------------------------------------------------------------------------
// XML helpers (pure, exported for testing)
// ---------------------------------------------------------------------------

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// Resolve the text content of a parsed node, whether it is a bare string or an
// object carrying attributes alongside a #text value (CDATA included).
function nodeText(node) {
  if (node === undefined || node === null) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object' && '#text' in node) {
    const text = node['#text'];
    return text === undefined || text === null ? null : String(text);
  }
  return null;
}

// Find a prop value across all <propstat> blocks of a <response> (a response can
// carry multiple propstats, e.g. one HTTP 200 and one HTTP 404).
function findProp(response, key) {
  for (const propstat of asArray(response && response.propstat)) {
    const prop = propstat && propstat.prop;
    if (prop && prop[key] !== undefined) return prop[key];
  }
  return undefined;
}

function absolutizeUrl(href) {
  const value = (href || '').trim();
  if (!value) return null;
  return value.startsWith('http') ? value : `${CALDAV_BASE}${value}`;
}

// iCloud records a subscription's upstream feed as webcal:// (occasionally
// webcals://). Those are ordinary http(s) URLs wearing a different scheme, which
// axios will not fetch, so rewrite them. Anything that is still not http(s)
// afterwards is rejected, so a hostile or malformed <cs:source> cannot talk us
// into fetching file:// or similar.
function normalizeFeedUrl(url) {
  const value = (url || '').trim();
  if (!value) return null;
  const rewritten = value.replace(/^webcals?:\/\//i, 'https://');
  return /^https?:\/\//i.test(rewritten) ? rewritten : null;
}

// Pull the <cs:source><d:href> feed URL out of a <response>, normalized.
function extractSourceHref(response) {
  const sourceProp = findProp(response, 'source');
  if (!sourceProp) return null;
  const href = asArray(sourceProp.href)[0];
  return normalizeFeedUrl(nodeText(href) ?? nodeText(sourceProp));
}

// True when a parsed resourcetype carries <cs:subscribed/>.
function isSubscribedResourceType(resourcetype) {
  return !!resourcetype && typeof resourcetype === 'object' && 'subscribed' in resourcetype;
}

function parseMultistatusResponses(xmlBody) {
  const doc = xmlParser.parse(xmlBody);
  return asArray(doc && doc.multistatus && doc.multistatus.response);
}

// Extract the current-user-principal URL from a PROPFIND response body.
function parsePrincipalUrl(xmlBody) {
  const responses = parseMultistatusResponses(xmlBody);
  for (const response of responses) {
    const cup = findProp(response, 'current-user-principal');
    if (cup) {
      const url = absolutizeUrl(nodeText(cup.href) ?? nodeText(cup));
      if (url) return url;
    }
  }
  // Fallback: first response-level href.
  for (const response of responses) {
    const url = absolutizeUrl(nodeText(response.href));
    if (url) return url;
  }
  return null;
}

// Extract the calendar-home-set URL from a PROPFIND response body.
function parseCalendarHomeUrl(xmlBody) {
  const responses = parseMultistatusResponses(xmlBody);
  for (const response of responses) {
    const home = findProp(response, 'calendar-home-set');
    if (home) {
      const url = absolutizeUrl(nodeText(home.href) ?? nodeText(home));
      if (url) return url;
    }
  }
  return null;
}

// Extract VEVENT-capable calendars from a Depth:1 PROPFIND response body.
function parseCalendars(xmlBody) {
  const calendars = [];

  for (const response of parseMultistatusResponses(xmlBody)) {
    const href = nodeText(response.href);
    if (!href) continue;

    // A collection holds events if it advertises VEVENT in its supported
    // component set. This is the most reliable signal and works across regular,
    // shared, and subscribed iCloud calendars (subscriptions use a
    // <cs:subscribed/> resourcetype rather than <C:calendar/>, so we must not
    // gate on resourcetype alone).
    const compSet = findProp(response, 'supported-calendar-component-set');
    const comps = compSet ? asArray(compSet.comp) : [];
    const supportsVevent = comps.some(
      (comp) => String(comp && comp['@_name'] ? comp['@_name'] : '').toUpperCase() === 'VEVENT'
    );

    // Fallback when no component set is advertised: accept calendar/subscribed
    // resource types (covers servers that omit supported-calendar-component-set)
    // while still excluding the calendar-home root and inbox/outbox collections.
    const resourcetype = findProp(response, 'resourcetype');
    const isCalendarResourceType = !!resourcetype && typeof resourcetype === 'object'
      && ('calendar' in resourcetype || 'subscribed' in resourcetype);

    const include = comps.length > 0 ? supportsVevent : isCalendarResourceType;
    if (!include) continue;

    const name = nodeText(findProp(response, 'displayname')) || 'Calendar';
    let color = nodeText(findProp(response, 'calendar-color'));
    // Apple returns colors like #RRGGBBAA; normalize to #RRGGBB.
    if (color && color.length === 9 && color.startsWith('#')) {
      color = color.slice(0, 7);
    }

    const calUrl = absolutizeUrl(href);
    calendars.push({
      id: calUrl,
      name,
      color: color || '#3d7ab5',
      url: calUrl,
      // Subscriptions hold no event resources of their own; sourceUrl is where
      // their events actually live. See fetchCalendarEvents.
      subscribed: isSubscribedResourceType(resourcetype),
      sourceUrl: extractSourceHref(response),
    });
  }

  return calendars;
}

// Read subscription details out of a Depth:0 PROPFIND body for one collection.
function parseCollectionSource(xmlBody) {
  for (const response of parseMultistatusResponses(xmlBody)) {
    const subscribed = isSubscribedResourceType(findProp(response, 'resourcetype'));
    const sourceUrl = extractSourceHref(response);
    if (subscribed || sourceUrl) return { subscribed, sourceUrl };
  }
  return { subscribed: false, sourceUrl: null };
}

// Extract the raw ICS payload strings from a calendar REPORT response body.
// The XML parser already unwraps CDATA and decodes XML entities, so the returned
// strings start at "BEGIN:VCALENDAR" and are ready for ICAL.parse().
function extractIcsPayloads(xmlBody) {
  const payloads = [];

  for (const response of parseMultistatusResponses(xmlBody)) {
    const ics = nodeText(findProp(response, 'calendar-data'));
    if (!ics) continue;

    const trimmed = ics.trim();
    if (trimmed.includes('BEGIN:VCALENDAR')) {
      payloads.push(trimmed);
    }
  }

  return payloads;
}

// ---------------------------------------------------------------------------
// CalDAV HTTP flows
// ---------------------------------------------------------------------------

// Discover the user's personal CalDAV principal URL via PROPFIND
async function discoverPrincipalUrl(appleId, appPassword) {
  const authHeader = buildAuthHeader(appleId, appPassword);

  // Apple requires a path suffix to avoid 400 errors on the bare domain
  const response = await axios({
    method: 'PROPFIND',
    url: `${CALDAV_BASE}/`,
    headers: {
      'Authorization': authHeader,
      'Depth': '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    data: ICLOUD_XML_MESSAGE.CURRENT_USER_PRINCIPAL,
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (response.status === 207 || response.status === 200) {
    const principalUrl = parsePrincipalUrl(response.data);
    if (principalUrl) return principalUrl;
  }

  throw new Error(`iCloud principal discovery failed (HTTP ${response.status}). Check your Apple ID and app-specific password.`);
}

// Find the calendar-home-set from the principal URL
async function discoverCalendarHome(principalUrl, appleId, appPassword) {
  const authHeader = buildAuthHeader(appleId, appPassword);

  const response = await axios({
    method: 'PROPFIND',
    url: principalUrl,
    headers: {
      'Authorization': authHeader,
      'Depth': '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    data: ICLOUD_XML_MESSAGE.CALENDAR_HOME_SET,
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (response.status === 207 || response.status === 200) {
    const homeUrl = parseCalendarHomeUrl(response.data);
    if (homeUrl) return homeUrl;

    // Fallback: derive from principal URL (Apple structure is /DSID/principal -> /DSID/calendars/)
    const dsidMatch = principalUrl.match(/\/(\d+)\//);
    if (dsidMatch) {
      const baseUrl = new URL(principalUrl);
      return `${baseUrl.protocol}//${baseUrl.host}/${dsidMatch[1]}/calendars/`;
    }
  }

  throw new Error(`Could not find iCloud calendar home (HTTP ${response.status}).`);
}

// List all calendars in the calendar home
async function listCalendars(calendarHomeUrl, appleId, appPassword) {
  const authHeader = buildAuthHeader(appleId, appPassword);

  const response = await axios({
    method: 'PROPFIND',
    url: calendarHomeUrl,
    headers: {
      'Authorization': authHeader,
      'Depth': '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    data: ICLOUD_XML_MESSAGE.CALENDAR_LIST,
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (response.status !== 207 && response.status !== 200) {
    throw new Error(`Failed to list iCloud calendars (HTTP ${response.status}).`);
  }

  return parseCalendars(response.data);
}

// Full discovery flow: credentials -> list of calendars
async function discoverAndListCalendars(appleId, appPassword) {
  const principalUrl = await discoverPrincipalUrl(appleId, appPassword);
  const homeUrl = await discoverCalendarHome(principalUrl, appleId, appPassword);
  const calendars = await listCalendars(homeUrl, appleId, appPassword);
  return { principalUrl, homeUrl, calendars };
}

// Convert a parsed ICS payload into HomeGlow event objects.
function icsToEvents(icsContent) {
  const comp = new ICAL.Component(ICAL.parse(icsContent));
  const vevents = comp.getAllSubcomponents('vevent');
  const events = [];

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    const dtstart = vevent.getFirstPropertyValue('dtstart');
    const isAllDay = dtstart?.isDate ?? false;
    const startDate = event.startDate.toJSDate();
    const rawEnd = event.endDate.toJSDate();
    const endDate = isAllDay ? subtractOneDay(rawEnd) : rawEnd;

    events.push({
      uid: event.uid || `apple-${Date.now()}-${Math.random()}`,
      title: event.summary || 'Untitled Event',
      start: startDate,
      end: endDate,
      description: event.description || null,
      location: event.location || null,
      all_day: isAllDay,
      raw: {},
    });
  }

  return events;
}

// Ask iCloud whether a collection is a subscription, and if so where its events
// really live. Depth:0 so it stays a cheap single-resource lookup.
async function describeCollection(calendarUrl, appleId, appPassword) {
  const response = await axios({
    method: 'PROPFIND',
    url: calendarUrl,
    headers: {
      'Authorization': buildAuthHeader(appleId, appPassword),
      'Depth': '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    data: ICLOUD_XML_MESSAGE.COLLECTION_SOURCE,
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (response.status !== 207 && response.status !== 200) {
    return { subscribed: false, sourceUrl: null };
  }

  return parseCollectionSource(response.data);
}

// Fetch a subscribed calendar's events straight from its upstream ICS feed.
// Deliberately unauthenticated: the feed is hosted by a third party (TeamSnap,
// leagues, school districts), so the iCloud app password must never be sent there.
async function fetchSubscriptionEvents(feedUrl) {
  const response = await axios.get(feedUrl, {
    timeout: 30000,
    responseType: 'text',
    // Keep the body a raw string; ICAL.parse needs the original text.
    transformResponse: [(data) => data],
    maxRedirects: 5,
    validateStatus: (s) => s < 500,
  });

  if (response.status !== 200) {
    throw new Error(`Failed to fetch subscribed calendar feed (HTTP ${response.status}).`);
  }

  return icsToEvents(response.data);
}

// Fetch events from a specific calendar URL using CalDAV REPORT
async function fetchCalendarEvents(calendarUrl, appleId, appPassword) {
  // An iCloud subscription (a webcal feed added to iCloud) is a pointer, not a
  // container: its resourcetype is <cs:subscribed/> and the events live at the
  // <cs:source> URL. A calendar-query REPORT against one succeeds but returns an
  // empty multistatus, which surfaced as "synced 0 events" with no error. Detect
  // that case and read the upstream feed instead.
  let subscription = { subscribed: false, sourceUrl: null };
  try {
    subscription = await describeCollection(calendarUrl, appleId, appPassword);
  } catch (err) {
    // Never let the probe break a calendar that the REPORT path already handled.
    console.warn('Subscription probe failed; falling back to CalDAV REPORT:', err.message);
  }

  if (subscription.subscribed) {
    if (!subscription.sourceUrl) {
      throw new Error('Subscribed iCloud calendar exposes no usable source feed URL.');
    }
    return fetchSubscriptionEvents(subscription.sourceUrl);
  }

  const authHeader = buildAuthHeader(appleId, appPassword);

  const now = Date.now();
  const timeMin = new Date(now - 13 * 30 * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now + 13 * 30 * 24 * 60 * 60 * 1000);

  const formatDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const response = await axios({
    method: 'REPORT',
    url: calendarUrl,
    headers: {
      'Authorization': authHeader,
      'Depth': '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    data: ICLOUD_XML_MESSAGE.CALENDAR_QUERY(formatDate(timeMin), formatDate(timeMax)),
    timeout: 30000,
    validateStatus: (s) => s < 500,
  });

  if (response.status !== 207 && response.status !== 200) {
    throw new Error(`Failed to fetch iCloud events (HTTP ${response.status}).`);
  }

  const events = [];

  for (const icsContent of extractIcsPayloads(response.data)) {
    try {
      events.push(...icsToEvents(icsContent));
    } catch (err) {
      console.warn('Failed to parse Apple CalDAV event block:', err.message);
    }
  }

  return events;
}

function subtractOneDay(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d;
}

// ---------------------------------------------------------------------------
// CalDAV write flows
//
// Create / update / delete for one event resource, mirroring the Google write
// path's contract: whole events only, the server's answer surfaces to the
// caller, and no write is ever retried blindly. Only the source's own stored
// credentials are used, and only against that source's calendar URL; the
// routes own that check, exactly as they do for the read path.
//
// Update and delete first locate the event's resource (href + etag) with the
// same time-range REPORT the read path uses, and match the UID client-side:
// iCloud answers UID-filtered CalDAV queries with a bare 412, so the UID is
// never sent as a query filter.
// ---------------------------------------------------------------------------

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const toYmd = (value) => (typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10));

// The calendar day after a 'YYYY-MM-DD', with no time zone in play.
function nextDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// An RRULE value ('FREQ=YEARLY'), with or without the 'RRULE:' prefix.
// undefined leaves recurrence alone, null/'' clears it, and anything that is
// not a plain FREQ rule is rejected: v1 writes whole events with at most a
// simple recurrence.
function normalizeRecurrence(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const rule = String(value).trim().replace(/^RRULE:/i, '');
  if (!/^FREQ=(YEARLY|MONTHLY|WEEKLY|DAILY)(;.+)?$/i.test(rule)) {
    throw httpError(400, 'recurrence must be a simple RRULE such as FREQ=YEARLY.');
  }
  return rule;
}

// Resolve the editor's start/end pair into ICAL.Time values, following the
// Google path's conventions: `all_day` carries an inclusive end date (a
// one-day event ends the day it starts) while `allDay` passes an exclusive
// end through. iCalendar all-day DTEND is always exclusive, so the inclusive
// form gains a day here, exactly as the Google body builder does.
function resolveEventTimes(event) {
  const inclusiveEnd = event.all_day !== undefined;
  const isAllDay = inclusiveEnd ? !!event.all_day : !!event.allDay;

  if (isAllDay) {
    const startDate = toYmd(event.start);
    let endDate = toYmd(event.end || event.start);
    if (inclusiveEnd) endDate = nextDay(endDate < startDate ? startDate : endDate);
    return {
      isAllDay,
      start: ICAL.Time.fromDateString(startDate),
      end: ICAL.Time.fromDateString(endDate),
    };
  }

  const start = new Date(event.start);
  const end = new Date(event.end || event.start);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError(400, 'Event start and end must be valid dates.');
  }
  return {
    isAllDay,
    start: ICAL.Time.fromJSDate(start, true),
    end: ICAL.Time.fromJSDate(end, true),
  };
}

// Serialize one event in the editor's body shape to a VCALENDAR document.
// Exported for tests; createEvent is the network caller.
function buildEventIcs(event, uid) {
  if (!event || typeof event !== 'object') {
    throw httpError(400, 'An event body is required.');
  }
  if (!event.start) {
    throw httpError(400, 'Event start is required.');
  }
  const times = resolveEventTimes(event);
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.addPropertyWithValue('prodid', '-//HomeGlow//Calendar//EN');
  calendar.addPropertyWithValue('version', '2.0');
  const vevent = new ICAL.Component('vevent');
  vevent.addPropertyWithValue('uid', uid);
  vevent.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  if (event.title !== undefined) vevent.addPropertyWithValue('summary', String(event.title ?? ''));
  if (event.description !== undefined && event.description !== null) {
    vevent.addPropertyWithValue('description', String(event.description));
  }
  if (event.location !== undefined && event.location !== null) {
    vevent.addPropertyWithValue('location', String(event.location));
  }
  vevent.addPropertyWithValue('dtstart', times.start);
  vevent.addPropertyWithValue('dtend', times.end);
  const rule = normalizeRecurrence(event.recurrence);
  if (rule) vevent.addPropertyWithValue('rrule', ICAL.Recur.fromString(rule));
  calendar.addSubcomponent(vevent);
  return serializeCalendar(calendar);
}

// ical.js joins lines with LF and leaves the last line unterminated; the
// wire format is CRLF throughout, final line included.
function serializeCalendar(calendar) {
  const text = calendar.toString().replace(/\r?\n/g, '\r\n');
  return text.endsWith('\r\n') ? text : `${text}\r\n`;
}

// Apply an editor body to a stored event document: fields the body omits
// keep their stored values, DTSTAMP always advances, and a stored RRULE is
// kept unless the body replaces it (a string) or clears it (null/'').
function mergeEventIcs(existingIcs, event) {
  const calendar = new ICAL.Component(ICAL.parse(existingIcs));
  const vevent = calendar.getFirstSubcomponent('vevent');
  if (!vevent) throw httpError(500, 'Stored calendar event could not be parsed.');

  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  if (event.title !== undefined) vevent.updatePropertyWithValue('summary', String(event.title ?? ''));
  if (event.description !== undefined) {
    if (event.description) vevent.updatePropertyWithValue('description', String(event.description));
    else vevent.removeProperty('description');
  }
  if (event.location !== undefined) {
    if (event.location) vevent.updatePropertyWithValue('location', String(event.location));
    else vevent.removeProperty('location');
  }

  const touchesTime = event.start !== undefined || event.end !== undefined
    || event.all_day !== undefined || event.allDay !== undefined;
  if (touchesTime) {
    const storedEvent = new ICAL.Event(vevent);
    const storedStart = vevent.getFirstPropertyValue('dtstart');
    const storedAllDay = storedStart?.isDate ?? false;
    const resolvedAllDay = event.all_day !== undefined ? !!event.all_day
      : event.allDay !== undefined ? !!event.allDay : storedAllDay;
    const spec = {};
    // Follow the caller's convention for the end edge: the editor's
    // `all_day` form (inclusive end) wins, then `allDay` (exclusive), then
    // the stored event's own kind.
    if (event.all_day !== undefined || (event.allDay === undefined && storedAllDay)) {
      spec.all_day = resolvedAllDay;
    } else {
      spec.allDay = resolvedAllDay;
    }
    spec.start = event.start !== undefined ? event.start : storedEvent.startDate.toJSDate();
    if (event.end !== undefined) {
      spec.end = event.end;
    } else {
      const rawEnd = storedEvent.endDate.toJSDate();
      // A stored all-day DTEND is exclusive; an inclusive spec wants the
      // last day itself.
      spec.end = resolvedAllDay && storedAllDay && spec.all_day !== undefined
        ? subtractOneDay(rawEnd)
        : rawEnd;
    }
    const times = resolveEventTimes(spec);
    vevent.updatePropertyWithValue('dtstart', times.start);
    vevent.updatePropertyWithValue('dtend', times.end);
  }

  const rule = normalizeRecurrence(event.recurrence);
  if (rule !== undefined) {
    if (rule) vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(rule));
    else vevent.removeProperty('rrule');
  }

  return serializeCalendar(calendar);
}

// Resolve an event resource href from a REPORT response. Hrefs arrive as
// absolute URLs or as paths; a path belongs to the same host as the calendar
// it was read from (the front door for stored sources, a shard host when a
// source ever points at one), so resolve against the calendar URL rather
// than assuming the front door.
function resolveResourceUrl(calendarUrl, href) {
  const value = (href || '').trim();
  if (!value) return null;
  if (value.startsWith('http')) return value;
  try {
    return new URL(value, calendarUrl).toString();
  } catch {
    return absolutizeUrl(value);
  }
}

// Locate one event's resource (href + etag + stored ICS) inside a calendar
// by UID, using the read path's time-range REPORT.
async function findEventResource(calendarUrl, appleId, appPassword, uid) {
  const now = Date.now();
  const timeMin = new Date(now - 13 * 30 * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now + 13 * 30 * 24 * 60 * 60 * 1000);
  const formatDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const response = await axios({
    method: 'REPORT',
    url: calendarUrl,
    headers: {
      'Authorization': buildAuthHeader(appleId, appPassword),
      'Depth': '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    data: ICLOUD_XML_MESSAGE.CALENDAR_QUERY(formatDate(timeMin), formatDate(timeMax)),
    timeout: 30000,
    validateStatus: (s) => s < 500,
  });

  if (response.status !== 207 && response.status !== 200) {
    throw httpError(response.status, `Failed to read iCloud calendar (HTTP ${response.status}).`);
  }

  for (const responseNode of parseMultistatusResponses(response.data)) {
    const ics = nodeText(findProp(responseNode, 'calendar-data'));
    if (!ics || !ics.includes('BEGIN:VCALENDAR')) continue;
    let events;
    try {
      events = icsToEvents(ics);
    } catch (err) {
      continue;
    }
    if (events.some((e) => e.uid === uid)) {
      return {
        href: resolveResourceUrl(calendarUrl, nodeText(responseNode.href)),
        etag: nodeText(findProp(responseNode, 'getetag')),
        ics: ics.trim(),
      };
    }
  }
  return null;
}

async function createEvent(calendarUrl, appleId, appPassword, event) {
  if (!event || !event.title || !String(event.title).trim()) {
    throw httpError(400, 'Event title is required.');
  }
  const uid = `${crypto.randomUUID()}@homeglow`;
  const ics = buildEventIcs(event, uid);
  const resourceUrl = `${calendarUrl.replace(/\/?$/, '/')}${encodeURIComponent(uid.split('@')[0])}.ics`;

  const response = await axios({
    method: 'PUT',
    url: resourceUrl,
    headers: {
      'Authorization': buildAuthHeader(appleId, appPassword),
      'Content-Type': 'text/calendar; charset=utf-8',
      // Create-only: a fresh UUID cannot collide, and if it somehow does
      // the write must fail rather than overwrite a stranger's event.
      'If-None-Match': '*',
    },
    data: ics,
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (response.status !== 201 && response.status !== 200 && response.status !== 204) {
    throw httpError(response.status, `iCloud refused the new event (HTTP ${response.status}).`);
  }
  return { id: uid, uid };
}

async function updateEvent(calendarUrl, appleId, appPassword, uid, event) {
  const found = await findEventResource(calendarUrl, appleId, appPassword, uid);
  if (!found) throw httpError(404, 'Event not found on this calendar.');
  const ics = mergeEventIcs(found.ics, event || {});

  const headers = {
    'Authorization': buildAuthHeader(appleId, appPassword),
    'Content-Type': 'text/calendar; charset=utf-8',
  };
  if (found.etag) headers['If-Match'] = found.etag;

  const response = await axios({
    method: 'PUT',
    url: found.href,
    headers,
    data: ics,
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (response.status === 412) {
    throw httpError(412, 'This event changed somewhere else since it was loaded. Sync and try again.');
  }
  if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
    throw httpError(response.status, `iCloud refused the event update (HTTP ${response.status}).`);
  }
  return { id: uid, uid };
}

async function deleteEvent(calendarUrl, appleId, appPassword, uid) {
  const found = await findEventResource(calendarUrl, appleId, appPassword, uid);
  if (!found) return { deleted: true, alreadyGone: true };

  const headers = { 'Authorization': buildAuthHeader(appleId, appPassword) };
  if (found.etag) headers['If-Match'] = found.etag;

  const response = await axios({
    method: 'DELETE',
    url: found.href,
    headers,
    timeout: 15000,
    validateStatus: (s) => s < 500,
  });

  if (response.status === 412) {
    throw httpError(412, 'This event changed somewhere else since it was loaded. Sync and try again.');
  }
  // 404 counts as success: the event is gone either way.
  if (response.status !== 200 && response.status !== 204 && response.status !== 404) {
    throw httpError(response.status, `iCloud refused the event delete (HTTP ${response.status}).`);
  }
  return { deleted: true };
}

module.exports = {
  discoverAndListCalendars,
  fetchCalendarEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  // Exported for unit testing (pure XML/ICS helpers, no network).
  ICLOUD_XML_MESSAGE,
  parsePrincipalUrl,
  parseCalendarHomeUrl,
  parseCalendars,
  parseCollectionSource,
  normalizeFeedUrl,
  extractIcsPayloads,
  icsToEvents,
  buildEventIcs,
  mergeEventIcs,
  findEventResource,
};
