const crypto = require('crypto');

const CALENDAR_ID  = process.env.GOOGLE_CALENDAR_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const RESEND_KEY   = process.env.RESEND_API_KEY;
// Set RESEND_FROM in Netlify env vars once you verify a domain in Resend (e.g. hola@psync.cl).
// Without it, only psync.cl@gmail.com can receive (onboarding@resend.dev restriction).
const RESEND_FROM  = process.env.RESEND_FROM || 'onboarding@resend.dev';
const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_KEY     = process.env.SUPABASE_ANON_KEY;
const TEAM_EMAIL   = 'psync.cl@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

function formatChile(fecha, hora) {
  const [y, mo, d] = fecha.split('-').map(Number);
  const h = parseInt(hora);
  const dow = new Date(y, mo - 1, d).getDay();
  return `${DIAS[dow]} ${d} de ${MESES[mo - 1]} de ${y}, ${h}:00 hrs`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { tipo, paciente_id, nombre, email, fecha, hora_inicio, token } = JSON.parse(event.body || '{}');

    if (!tipo || !nombre || !email || !fecha || !hora_inicio) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan campos requeridos' }) };
    }

    const supaHeaders = {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
    };

    // Validate token if psychologist flow
    if (token) {
      const chk = await fetch(
        `${SUPA_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}&select=estado`,
        { headers: supaHeaders }
      );
      const chkData = await chk.json();
      if (!chkData.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Link inválido o expirado' }) };
      if (chkData[0].estado === 'confirmada') return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Este link ya fue utilizado' }) };
    }

    // Build datetime strings with Chile timezone offset
    const h = parseInt(hora_inicio);
    const off = chileOffsetHours(fecha);
    const absOff = Math.abs(off);
    const offStr = `${off < 0 ? '-' : '+'}${String(absOff).padStart(2, '0')}:00`;
    const startDT = `${fecha}T${String(h).padStart(2, '0')}:00:00${offStr}`;
    const endDT   = `${fecha}T${String(h + 1).padStart(2, '0')}:00:00${offStr}`;

    const tipoLabel = tipo === 'arquitectura' ? 'Sesión de Arquitectura' : 'Entrevista psicólogo/a';

    // Create Google Calendar event
    const gToken = await getGoogleToken();
    const evRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${gToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `${tipoLabel} — ${nombre}`,
          description: `Email: ${email}${paciente_id ? '\nPaciente ID: ' + paciente_id : ''}`,
          start: { dateTime: startDT, timeZone: 'America/Santiago' },
          end:   { dateTime: endDT,   timeZone: 'America/Santiago' },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 60 },
              { method: 'popup', minutes: 15 },
            ],
          },
        }),
      }
    );
    const evData = await evRes.json();
    if (!evData.id) throw new Error('Error al crear evento en Calendar: ' + JSON.stringify(evData));

    const googleEventId = evData.id;

    // Jitsi Meet: link único por sesión, gratis, sin cuenta ni API key
    const roomSuffix = crypto.randomBytes(5).toString('hex');
    const meetLink = `https://meet.jit.si/psync-${fecha.replace(/-/g, '')}-${roomSuffix}`;

    console.log(`Evento creado: ${googleEventId} | Meet: ${meetLink}`);

    // Persist to Supabase
    if (token) {
      await fetch(
        `${SUPA_URL}/rest/v1/sesiones?token=eq.${encodeURIComponent(token)}`,
        {
          method: 'PATCH',
          headers: supaHeaders,
          body: JSON.stringify({
            nombre, email, fecha, hora_inicio,
            google_event_id: googleEventId,
            meet_link: meetLink,
            estado: 'confirmada',
          }),
        }
      );
    } else {
      await fetch(`${SUPA_URL}/rest/v1/sesiones`, {
        method: 'POST',
        headers: { ...supaHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({
          tipo, nombre, email, fecha, hora_inicio,
          google_event_id: googleEventId,
          meet_link: meetLink,
          estado: 'confirmada',
          paciente_id: paciente_id || null,
        }),
      });
    }

    // ── Email ──────────────────────────────────────────────────────────────
    const fechaFmt = formatChile(fecha, hora_inicio);

    const meetBlock = meetLink
      ? `<a href="${meetLink}" style="display:inline-block;background:#6B3C24;color:#F2ECE4 !important;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px;margin-top:6px;">Abrir videollamada →</a>`
      : `<p style="margin:0;font-size:14px;color:#7A5840;">Te enviaremos el link de videollamada por correo 24 horas antes de tu sesión.</p>`;

    const cnipBlock = tipo === 'arquitectura' ? `
      <div style="margin:28px 0 0;padding:20px 24px;background:#F0EBE3;border-left:3px solid #B8CDD4;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#7A5840;">Antes de tu sesión · 5 minutos</p>
        <p style="margin:0 0 14px;font-size:14px;color:#3D2212;line-height:1.65;">Para aprovecharla al máximo, completa esta breve encuesta sobre cómo te imaginas tu terapia ideal. No hay respuestas correctas — nos ayuda a llegar preparadas para ti.</p>
        <a href="https://docs.google.com/forms/d/1NILswSE8ITYr5bPln-Dd_Q1MBV5uj04o7UHIqh4PyvI"
           style="display:inline-block;background:#3D2212;color:#F2ECE4 !important;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">
          Completar encuesta →
        </a>
      </div>` : '';

    const emailHtml = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#3D2212;">
  <div style="background:#6B3C24;padding:32px 40px;border-radius:12px 12px 0 0;">
    <p style="color:rgba(242,236,228,0.7);font-size:11px;letter-spacing:0.18em;margin:0 0 10px;text-transform:uppercase;font-weight:600;">PSYNC</p>
    <h1 style="color:#F2ECE4;font-size:22px;margin:0;font-weight:700;line-height:1.3;">
      ${tipo === 'arquitectura' ? 'Sesión de Arquitectura confirmada' : 'Entrevista PSYNC confirmada'}
    </h1>
  </div>

  <div style="background:#FDFAF7;padding:32px 40px 36px;border-radius:0 0 12px 12px;border:1px solid #DDD4C8;border-top:none;">
    <p style="margin:0 0 16px;">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 24px;line-height:1.65;color:#3D2212;">${tipo === 'arquitectura'
      ? 'Tu Sesión de Arquitectura con el equipo PSYNC quedó agendada. En esta conversación de 1 hora profundizamos en lo que nos contaste y empezamos a diseñar tu match terapéutico.'
      : 'Tu entrevista de incorporación a la red de psicólogos/as PSYNC quedó agendada.'
    }</p>

    <div style="background:#F2ECE4;border-radius:10px;padding:22px 24px;margin-bottom:24px;">
      <p style="margin:0 0 14px;font-size:15px;"><strong>📅</strong>&nbsp; ${fechaFmt}</p>
      <p style="margin:0 0 14px;font-size:13px;color:#7A5840;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Videollamada</p>
      ${meetBlock}
    </div>

    ${cnipBlock}

    <p style="margin-top:28px;color:#7A5840;font-size:13px;line-height:1.6;">¿Necesitas reprogramar? Responde este correo o escríbenos a <a href="mailto:${TEAM_EMAIL}" style="color:#6B3C24;font-weight:600;">${TEAM_EMAIL}</a></p>
    <p style="margin-top:20px;color:#3D2212;">— Equipo PSYNC</p>
  </div>
</div>`;

    // Send to patient (to:) and copy team (cc:).
    // NOTE: if RESEND_FROM is not set (using onboarding@resend.dev), Resend
    // can only deliver to the account owner's email (psync.cl@gmail.com).
    // To reach patients, set RESEND_FROM=hola@psync.cl in Netlify env vars
    // after verifying the psync.cl domain in your Resend account.
    const emailTo = RESEND_FROM !== 'onboarding@resend.dev'
      ? [email]
      : [TEAM_EMAIL];
    const emailCc = RESEND_FROM !== 'onboarding@resend.dev'
      ? [TEAM_EMAIL]
      : [];

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `PSYNC <${RESEND_FROM}>`,
        to: emailTo,
        ...(emailCc.length ? { cc: emailCc } : {}),
        reply_to: TEAM_EMAIL,
        subject: tipo === 'arquitectura'
          ? `Sesión de Arquitectura confirmada — ${fechaFmt}`
          : `Entrevista PSYNC confirmada — ${fechaFmt}`,
        html: emailHtml,
      }),
    });

    const resendData = await resendRes.json();
    if (resendData.error || !resendRes.ok) {
      console.error('Resend error (booking saved, email failed):', JSON.stringify(resendData),
        '| paciente:', email, '| from:', RESEND_FROM);
    } else {
      console.log('Email enviado OK. ID:', resendData.id, '| to:', emailTo.join(', '));
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, fecha, hora_inicio, meet_link: meetLink }),
    };
  } catch (err) {
    console.error('calendar-book error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
