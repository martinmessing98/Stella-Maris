import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface QuickBooksTokenSession {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: number;
  companyName?: string;
}

const qbSessions = new Map<string, QuickBooksTokenSession>();

function getAppUrl(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function getQbEnvironment(): 'sandbox' | 'production' {
  return process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}

function getQbApiBase(): string {
  return getQbEnvironment() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function setIframeCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Partitioned',
  ];
  res.append('Set-Cookie', parts.join('; '));
}

function clearIframeCookie(res: Response, name: string) {
  const parts = [
    `${name}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Partitioned',
  ];
  res.append('Set-Cookie', parts.join('; '));
}

function verifyMutationOrigin(req: Request): boolean {
  const xrw = req.headers['x-requested-with'];
  if (xrw === 'FieldLedger') {
    return true;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  if (!origin || !host) {
    return false;
  }
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host;
  } catch {
    return false;
  }
}

async function refreshQuickBooksTokenIfNeeded(sessionId: string, session: QuickBooksTokenSession): Promise<QuickBooksTokenSession> {
  if (Date.now() < session.expiresAt - 60_000) {
    return session;
  }
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret || !session.refreshToken) {
    return session;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  });

  const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    return session;
  }

  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const updated: QuickBooksTokenSession = {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  qbSessions.set(sessionId, updated);
  return updated;
}

async function createServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'FieldLedger' });
  });

  // QuickBooks OAuth Status
  app.get('/api/quickbooks/status', (req, res) => {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID?.trim();
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET?.trim();
    const configured = Boolean(clientId && clientSecret);
    const sessionId = req.cookies?.qb_session_id as string | undefined;
    const session = sessionId ? qbSessions.get(sessionId) : undefined;
    const callbackUrl = `${getAppUrl(req)}/api/quickbooks/callback`;

    res.json({
      configured,
      connected: Boolean(session),
      environment: getQbEnvironment(),
      realmId: session?.realmId || null,
      companyName: session?.companyName || null,
      callbackUrl,
    });
  });

  // Construct QuickBooks OAuth Authorization URL for Popup
  app.get('/api/quickbooks/auth/url', (req, res) => {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID?.trim();
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: 'QuickBooks credentials are not configured yet. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in Secrets.',
      });
    }

    const redirectUri = `${getAppUrl(req)}/api/quickbooks/callback`;
    const state = crypto.randomBytes(24).toString('hex');
    setIframeCookie(res, 'qb_oauth_state', state, 600);

    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });

    const url = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
    return res.json({ url, redirectUri });
  });

  // QuickBooks OAuth Callback Handler (handles trailing slash variations)
  const handleQuickBooksCallback = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const realmId = typeof req.query.realmId === 'string' ? req.query.realmId : '';
    const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

    if (errorParam) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;padding:24px;">
          <h3>QuickBooks Authorization Cancelled</h3>
          <p>You may close this window.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'QUICKBOOKS_OAUTH_ERROR', error: ${JSON.stringify(errorParam)} }, '*');
              window.close();
            }
          </script>
        </body></html>
      `);
    }

    const expectedState = req.cookies?.qb_oauth_state as string | undefined;
    clearIframeCookie(res, 'qb_oauth_state');

    if (!code || !state || !expectedState || state !== expectedState || !/^\d+$/.test(realmId)) {
      return res.status(400).send('Invalid OAuth callback state or authorization code.');
    }

    const clientId = process.env.QUICKBOOKS_CLIENT_ID?.trim();
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return res.status(500).send('QuickBooks credentials are not configured on the server.');
    }

    try {
      const redirectUri = `${getAppUrl(req)}/api/quickbooks/callback`;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: tokenBody.toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error('QuickBooks token exchange failed:', tokenRes.status, errText);
        return res.status(502).send('Failed to exchange QuickBooks authorization code.');
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      let companyName = `QuickBooks Company #${realmId}`;
      try {
        const infoRes = await fetch(
          `${getQbApiBase()}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=73`,
          {
            headers: {
              Authorization: `Bearer ${tokenData.access_token}`,
              Accept: 'application/json',
            },
          }
        );
        if (infoRes.ok) {
          const infoJson = (await infoRes.json()) as { CompanyInfo?: { CompanyName?: string } };
          if (infoJson.CompanyInfo?.CompanyName) {
            companyName = infoJson.CompanyInfo.CompanyName;
          }
        }
      } catch {
        // Fallback to realmId label
      }

      const sessionId = crypto.randomBytes(24).toString('hex');
      qbSessions.set(sessionId, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        realmId,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        companyName,
      });

      setIframeCookie(res, 'qb_session_id', sessionId, 60 * 60 * 24 * 7);

      return res.send(`
        <html>
          <body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a;">
            <p>QuickBooks Online connected successfully. Returning to FieldLedger...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'QUICKBOOKS_OAUTH_SUCCESS', realmId: ${JSON.stringify(realmId)}, companyName: ${JSON.stringify(companyName)} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('QuickBooks callback error:', err);
      return res.status(500).send('Unexpected error during QuickBooks authentication.');
    }
  };

  app.get(['/api/quickbooks/callback', '/api/quickbooks/callback/'], handleQuickBooksCallback);

  app.post('/api/quickbooks/disconnect', (req, res) => {
    if (!verifyMutationOrigin(req)) {
      return res.status(403).json({ error: 'Invalid request origin' });
    }
    const sessionId = req.cookies?.qb_session_id as string | undefined;
    if (sessionId) {
      qbSessions.delete(sessionId);
    }
    clearIframeCookie(res, 'qb_session_id');
    return res.json({ disconnected: true });
  });

  // Sync Invoices & Payments from QuickBooks Online
  app.get('/api/quickbooks/sync', async (req, res) => {
    const sessionId = req.cookies?.qb_session_id as string | undefined;
    const rawSession = sessionId ? qbSessions.get(sessionId) : undefined;
    if (!sessionId || !rawSession) {
      return res.status(401).json({ error: 'QuickBooks Online is not connected.' });
    }

    try {
      const session = await refreshQuickBooksTokenIfNeeded(sessionId, rawSession);
      const base = `${getQbApiBase()}/v3/company/${encodeURIComponent(session.realmId)}/query`;

      const [invRes, payRes] = await Promise.all([
        fetch(`${base}?query=${encodeURIComponent('SELECT * FROM Invoice MAXRESULTS 50')}&minorversion=73`, {
          headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
        }),
        fetch(`${base}?query=${encodeURIComponent('SELECT * FROM Payment MAXRESULTS 50')}&minorversion=73`, {
          headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
        }),
      ]);

      if (!invRes.ok || !payRes.ok) {
        const detail = !invRes.ok ? await invRes.text() : await payRes.text();
        return res.status(502).json({ error: 'QuickBooks API query failed', detail });
      }

      const invJson = (await invRes.json()) as {
        QueryResponse?: {
          Invoice?: Array<{
            Id: string;
            DocNumber?: string;
            TxnDate?: string;
            TotalAmt?: number;
            Balance?: number;
            CustomerRef?: { name?: string; value?: string };
            PrivateNote?: string;
          }>;
        };
      };
      const payJson = (await payRes.json()) as {
        QueryResponse?: {
          Payment?: Array<{
            Id: string;
            TxnDate?: string;
            TotalAmt?: number;
            CustomerRef?: { name?: string; value?: string };
            PaymentMethodRef?: { name?: string };
            PaymentRefNum?: string;
          }>;
        };
      };

      return res.json({
        realmId: session.realmId,
        companyName: session.companyName,
        invoices: invJson.QueryResponse?.Invoice || [],
        payments: payJson.QueryResponse?.Payment || [],
      });
    } catch (err) {
      console.error('QuickBooks sync error:', err);
      return res.status(500).json({ error: 'Failed to sync QuickBooks data.' });
    }
  });

  // Create Invoice or Record Payment in QuickBooks Online
  app.post('/api/quickbooks/invoices', async (req, res) => {
    if (!verifyMutationOrigin(req)) {
      return res.status(403).json({ error: 'Invalid request origin' });
    }
    const sessionId = req.cookies?.qb_session_id as string | undefined;
    const rawSession = sessionId ? qbSessions.get(sessionId) : undefined;
    if (!sessionId || !rawSession) {
      return res.status(401).json({ error: 'QuickBooks Online is not connected.' });
    }

    const { customerName, amount, description, txnDate } = req.body as {
      customerName?: string;
      amount?: number;
      description?: string;
      txnDate?: string;
    };

    if (
      typeof customerName !== 'string' ||
      !customerName.trim() ||
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({ error: 'Valid customerName and positive amount are required.' });
    }

    try {
      const session = await refreshQuickBooksTokenIfNeeded(sessionId, rawSession);
      const baseUrl = `${getQbApiBase()}/v3/company/${encodeURIComponent(session.realmId)}`;
      const safeName = customerName.trim().slice(0, 100).replace(/'/g, "\\'");

      // 1. Lookup or create Customer in QuickBooks
      const custQuery = await fetch(
        `${baseUrl}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${safeName}' MAXRESULTS 1`)}&minorversion=73`,
        { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' } }
      );
      const custData = (await custQuery.json()) as { QueryResponse?: { Customer?: Array<{ Id: string; DisplayName: string }> } };
      let customerId = custData.QueryResponse?.Customer?.[0]?.Id;

      if (!customerId) {
        const createCust = await fetch(`${baseUrl}/customer?minorversion=73`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ DisplayName: customerName.trim().slice(0, 100) }),
        });
        if (!createCust.ok) {
          return res.status(502).json({ error: 'Failed to create QuickBooks customer.' });
        }
        const createdCust = (await createCust.json()) as { Customer?: { Id: string } };
        customerId = createdCust.Customer?.Id;
      }

      if (!customerId) {
        return res.status(502).json({ error: 'Unable to resolve QuickBooks customer ID.' });
      }

      // 2. Lookup default Service Item
      const itemQuery = await fetch(
        `${baseUrl}/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1")}&minorversion=73`,
        { headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' } }
      );
      const itemData = (await itemQuery.json()) as { QueryResponse?: { Item?: Array<{ Id: string; Name: string }> } };
      const serviceItemId = itemData.QueryResponse?.Item?.[0]?.Id || '1';

      // 3. Create Invoice
      const invoicePayload = {
        CustomerRef: { value: customerId },
        TxnDate: typeof txnDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(txnDate) ? txnDate : undefined,
        PrivateNote: typeof description === 'string' ? description.slice(0, 400) : 'FieldLedger Contracting Invoice',
        Line: [
          {
            Amount: Number(amount.toFixed(2)),
            DetailType: 'SalesItemLineDetail',
            Description: typeof description === 'string' ? description.slice(0, 400) : 'Contracting Services',
            SalesItemLineDetail: {
              ItemRef: { value: serviceItemId },
            },
          },
        ],
      };

      const invCreate = await fetch(`${baseUrl}/invoice?minorversion=73`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(invoicePayload),
      });

      if (!invCreate.ok) {
        const errBody = await invCreate.text();
        return res.status(502).json({ error: 'Failed to create QuickBooks invoice.', detail: errBody });
      }

      const invResult = (await invCreate.json()) as {
        Invoice?: { Id: string; DocNumber?: string; TotalAmt?: number; Balance?: number };
      };

      return res.json({ invoice: invResult.Invoice });
    } catch (err) {
      console.error('QuickBooks invoice creation error:', err);
      return res.status(500).json({ error: 'Failed to push invoice to QuickBooks.' });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production build not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FieldLedger server running on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
