const crypto = require('crypto');

const CALENDAR_ID  = process.env.GOOGLE_CALENDAR_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

async function getGoogleToken() {
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const pld = Buffer.from(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${hdr}.${pld}`);
  const jwt = `${hdr}.${pld}.${sign.sign(PRIVATE_KEY, 'base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('Google auth failed: ' + JSON.stringify(d));
  return d.access_token;
}

function chileOffsetHours(dateStr) {
  try {
    const ref = new Date(dateStr + 'T12:00:00Z');
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'America/Santiago',
      timeZoneName: 'shortOffset',
    }).formatToParts(ref);
    const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-4';
    const m = tz.match(/GMT([+-]\d+)/);
    return m ? parseInt(m[1]) : -4;
  } catch {
    return -4;
  }
}

// Converts a Chile date string + hour (0-23) to UTC Date
function chileToUTC(dateStr, hour) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const off = chileOffsetHours(dateStr);
  return new Date(Date.UTC(y, mo - 1, d, hour - off));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const gToken = await getGoogleToken();

    // Get current Chile date and hour
    const now = new Date();
    const chileParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t) => chileParts.find(p => p.type === t)?.value;
    const todayStr = `${get('year')}-${get('month')}-${get('day')}`;
    const currentHour = parseInt(get('hour'));

    // Build list of weekdays in next 14 days
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const todayUTC = new Date(Date.UTC(ty, tm - 1, td));
    const dates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(todayUTC.getTime() + i * 86400000);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      dates.push(d.toISOString().split('T')[0]);
    }

    if (dates.length === 0) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ slots: [] }) };
    }

    // Query FreeBusy
    const timeMin = chileToUTC(todayStr, 9).toISOString();
    const timeMax = chileToUTC(dates[dates.length - 1], 21).toISOString();

    const fbRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${gToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin, timeMax,
        timeZone: 'America/Santiago',
        items: [{ id: CALENDAR_ID }],
      }),
    });
    const fbData = await fbRes.json();
    const busy = (fbData.calendars?.[CALENDAR_ID]?.busy || []).map(b => ({
      s: new Date(b.start).getTime(),
      e: new Date(b.end).getTime(),
    }));

    // Generate available slots
    const slots = [];
    for (const dateStr of dates) {
      for (let h = 9; h < 21; h++) {
        if (dateStr === todayStr && h <= currentHour + 1) continue;

        const start = chileToUTC(dateStr, h);
        const end   = chileToUTC(dateStr, h + 1);
        const sMs = start.getTime();
        const eMs = end.getTime();

        const booked = busy.some(b => b.s < eMs && b.e > sMs);
        if (!booked) {
          slots.push({
            date: dateStr,
            hora: `${String(h).padStart(2, '0')}:00`,
          });
        }
      }
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ slots }) };
  } catch (err) {
    console.error('calendar-slots error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
