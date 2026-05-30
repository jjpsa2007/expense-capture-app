/**
 * Vercel Serverless Function
 * Handles GET (fetch from KV) and POST (save to KV) for Co-Ledger State.
 * Uses pure Node.js native fetch and the direct Upstash REST API command syntax.
 */
export default async function handler(req, res) {
  // 1. Enable standard Cross-Origin Resource Sharing (CORS)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Respond immediately to OPTIONS preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. Resolve Vercel KV environment variables (injected by Vercel upon database connection)
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  if (!KV_URL || !KV_TOKEN) {
    // If not connected yet, return a clear error indicator so the frontend can fallback gracefully
    return res.status(503).json({
      error: 'Vercel KV is not configured',
      message: 'KV_REST_API_URL and KV_REST_API_TOKEN environment variables are missing. Please link a KV database in your Vercel Dashboard.'
    });
  }

  try {
    // 3. READ OPERATION (GET)
    if (req.method === 'GET') {
      const kvResponse = await fetch(`${KV_URL}/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['GET', 'co_ledger_state']),
      });

      if (!kvResponse.ok) {
        throw new Error(`Upstash REST GET error: ${kvResponse.statusText}`);
      }

      const kvData = await kvResponse.json();
      const rawResult = kvData.result;

      if (!rawResult) {
        // Return empty ledger structures if first-time initialize
        return res.status(200).json({ expenses: [], fundings: [] });
      }

      // Vercel KV stores it as a stringified JSON payload, parse and return it
      return res.status(200).json(JSON.parse(rawResult));
    }

    // 4. WRITE OPERATION (POST)
    if (req.method === 'POST') {
      const dataToSave = req.body;
      if (!dataToSave || typeof dataToSave !== 'object') {
        return res.status(400).json({ error: 'Invalid ledger payload format.' });
      }

      const kvResponse = await fetch(`${KV_URL}/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['SET', 'co_ledger_state', JSON.stringify(dataToSave)]),
      });

      if (!kvResponse.ok) {
        throw new Error(`Upstash REST SET error: ${kvResponse.statusText}`);
      }

      return res.status(200).json({ success: true, message: 'Cloud sync complete' });
    }

    // Handle unsupported requests
    return res.status(405).json({ error: `HTTP Method ${req.method} not allowed.` });
  } catch (error) {
    console.error('[API Serverless Error]:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
