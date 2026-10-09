const COMMERCE_CODE = process.env.TBK_COMMERCE_CODE;
const API_KEY = process.env.TBK_API_KEY;
const TBK_URL = 'https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { buy_order, session_id, return_url } = body;

  if (!buy_order || !session_id || !return_url) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan parámetros requeridos' }) };
  }

  try {
    const res = await fetch(TBK_URL, {
      method: 'POST',
      headers: {
        'Tbk-Api-Key-Id': COMMERCE_CODE,
        'Tbk-Api-Key-Secret': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        buy_order,
        session_id,
        amount: 25000,
        return_url,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data.error_message || 'Error al conectar con Transbank' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.token, url: data.url }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No se pudo conectar con Transbank' }),
    };
  }
};
