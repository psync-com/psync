const COMMERCE_CODE = process.env.TBK_COMMERCE_CODE;
const API_KEY = process.env.TBK_API_KEY;
const TBK_BASE = 'https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions';

exports.handler = async (event) => {
  const siteUrl = process.env.URL || 'https://psync-com.netlify.app';

  const params = new URLSearchParams(event.body || '');
  const token = params.get('token_ws');
  const tbkToken = params.get('TBK_TOKEN');

  // User cancelled payment (Webpay sends TBK_TOKEN instead of token_ws on cancel/timeout)
  if (!token) {
    const dest = tbkToken ? 'cancelado' : 'error';
    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/agenda.html?pago=${dest}` },
      body: '',
    };
  }

  try {
    const res = await fetch(`${TBK_BASE}/${token}`, {
      method: 'PUT',
      headers: {
        'Tbk-Api-Key-Id': COMMERCE_CODE,
        'Tbk-Api-Key-Secret': API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();

    if (data.response_code === 0) {
      return {
        statusCode: 302,
        headers: { Location: `${siteUrl}/agenda.html?pago=ok` },
        body: '',
      };
    }

    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/agenda.html?pago=error` },
      body: '',
    };
  } catch {
    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/agenda.html?pago=error` },
      body: '',
    };
  }
};
