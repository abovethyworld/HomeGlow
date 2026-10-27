// Household alternating pattern: two members swap weekday sets every other
// week. Mirrors client/src/utils/pattern.js; keep the two in sync.
//
// Config shape (settings key 'household_pattern', JSON):
//   { members: [1, 2],
//     days: { "1": [0, 1, 3, 5], "2": [2, 4, 6] },
//     anchorSunday: "2026-10-25" }
// Weekday numbers follow cron: 0 = Sunday. The anchor Sunday starts a normal
// week; every other week the two members' day sets swap. The days are
// expected to partition the week; a weekday in neither set falls to the
// second member.
const DAY_MS = 24 * 60 * 60 * 1000;

function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function weeksSinceAnchor(dateStr, anchorSunday) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [ay, am, ad] = String(anchorSunday).split('-').map(Number);
  const day = Date.UTC(y, m - 1, d);
  const anchor = Date.UTC(ay, am - 1, ad);
  return Math.floor((day - anchor) / (7 * DAY_MS));
}

function patternOwnerForDate(pattern, dateStr) {
  if (!pattern || !Array.isArray(pattern.members) || pattern.members.length !== 2) return null;
  if (!pattern.anchorSunday) return null;
  const days = pattern.days || {};
  const weekday = weekdayOf(dateStr);
  const flipped = ((weeksSinceAnchor(dateStr, pattern.anchorSunday) % 2) + 2) % 2 === 1;
  const [a, b] = pattern.members;
  const aDays = days[String(a)] || [];
  const base = aDays.includes(weekday) ? a : b;
  if (!flipped) return base;
  return base === a ? b : a;
}

// Whether a schedule fires on dateStr under the pattern. Fixed schedules are
// unaffected. A pattern schedule fires only for the pattern owner that day.
// With no pattern configured, or a broken one, fail open: behave as before
// rather than hiding chores.
function patternAllows(pattern, schedule, dateStr) {
  if (!schedule || schedule.owner_rule !== 'pattern') return true;
  if (!pattern) return true;
  const owner = patternOwnerForDate(pattern, dateStr);
  if (owner === null) return true;
  return Number(owner) === Number(schedule.user_id);
}

module.exports = { patternOwnerForDate, patternAllows };
