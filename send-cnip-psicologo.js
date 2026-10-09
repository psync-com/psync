const RESEND_KEY  = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const TEAM_EMAIL  = 'psync.cl@gmail.com';
const CNIP_URL    = 'https://docs.google.com/forms/d/1CvZhe-TfOPZzh_qTEGMCjayZ2YlffGu-N61AfWKnaqQ';
const SUPA_URL    = process.env.SUPABASE_URL;
const SUPA_KEY    = process.env.SUPABASE_ANON_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { psicologo_id, nombre, email } = JSON.parse(event.body || '{}');

    if (!email || !nombre) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan nombre y email' }) };
    }

    const emailHtml = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#3D2212;">
  <div style="background:#6B3C24;padding:32px 40px;border-radius:12px 12px 0 0;">
    <p style="color:rgba(242,236,228,0.7);font-size:11px;letter-spacing:0.18em;margin:0 0 10px;text-transform:uppercase;font-weight:600;">PSYNC</p>
    <h1 style="color:#F2ECE4;font-size:22px;margin:0;font-weight:700;line-height:1.3;">Tu perfil terapéutico</h1>
  </div>

  <div style="background:#FDFAF7;padding:32px 40px 36px;border-radius:0 0 12px 12px;border:1px solid #DDD4C8;border-top:none;">
    <p style="margin:0 0 16px;">Hola <strong>${nombre}</strong>,</p>
    <p style="margin:0 0 24px;line-height:1.65;color:#3D2212;">
      Para poder hacer el mejor match con nuestros pacientes, necesitamos conocer tu estilo terapéutico.
      Te enviamos una breve encuesta de 5 minutos — no hay respuestas correctas, solo queremos entender cómo trabajas.
    </p>

    <div style="background:#F2ECE4;border-radius:10px;padding:22px 24px;margin-bottom:24px;text-align:center;">
      <a href="${CNIP_URL}"
         style="display:inline-block;background:#6B3C24;color:#F2ECE4 !important;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">
        Completar encuesta →
      </a>
      <p style="margin:14px 0 0;font-size:13px;color:#7A5840;">Demora aproximadamente 5 minutos</p>
    </div>

    <p style="margin-top:20px;color:#7A5840;font-size:13px;line-height:1.6;">¿Tienes preguntas? Escríbenos a <a href="mailto:${TEAM_EMAIL}" style="color:#6B3C24;font-weight:600;">${TEAM_EMAIL}</a></p>
    <p style="margin-top:20px;color:#3D2212;">— Equipo PSYNC</p>
  </div>
</div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `PSYNC <${RESEND_FROM}>`,
        to: [email],
        reply_to: TEAM_EMAIL,
        subject: 'Tu perfil terapéutico — PSYNC',
        html: emailHtml,
      }),
    });

    const resendData = await resendRes.json();
    if (resendData.error || !resendRes.ok) {
      console.error('Resend error:', JSON.stringify(resendData));
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Error al enviar email' }) };
    }

    console.log('C-NIP psicólogo enviado. ID:', resendData.id, '| to:', email);

    if (psicologo_id) {
      await fetch(`${SUPA_URL}/rest/v1/psicologos?id=eq.${psicologo_id}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cnip_enviado: true }),
      });
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('send-cnip-psicologo error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
