// Daily Ops email report — Skelsee Fuel Sales / Ops Planner
//
// Triggered on a schedule (see supabase/functions/daily-report/cron.sql) or
// manually via a POST to this function's URL. Reads the same data the Ops
// Planner's dashboard tab shows (ops/index.html: renderDeliveries(),
// loadChase()) plus a few database-visible health checks, and emails the
// result via Resend.
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY       - from resend.com
//   REPORT_RECIPIENTS    - comma-separated emails (optional, defaults below)
//   REPORT_FROM          - "Name <email>" sender (optional, defaults below)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Supabase Edge runtime — never set those manually and never put them
// in client-side code.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HARARE_OFFSET_MS = 2 * 60 * 60 * 1000; // UTC+2, no DST

const STATUS_COL: Record<string, string> = {
  overdue: '#BA7517',
  due_now: '#3B6D11',
};

function harareToday(): string {
  return new Date(Date.now() + HARARE_OFFSET_MS).toISOString().split('T')[0];
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() + HARARE_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

const ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s: unknown): string {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

Deno.serve(async () => {
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const today = harareToday();
    const cutoff60 = daysAgo(60);
    // Timestamps compared as epoch ms, not strings — Postgres returns
    // timestamptz as "...+00:00" while JS toISOString() gives "...Z", and
    // those two suffixes don't sort correctly against each other as text.
    const since24hMs = Date.now() - 24 * 60 * 60 * 1000;
    const since24h = new Date(since24hMs).toISOString();
    const todayStartMs = new Date(today + 'T00:00:00Z').getTime() - HARARE_OFFSET_MS;
    const yesterdayStartMs = todayStartMs - 24 * 60 * 60 * 1000;

    // ---- deliveries (mirrors ops/index.html renderDeliveries()) ----
    const { data: salesRows, error: salesErr } = await sb
      .from('sales')
      .select('id,customer,litres,fuel_type,delivery_date,status,delivered_at,location,sale_date,price_tba,created_at')
      .neq('status', 'cancelled')
      .gte('sale_date', cutoff60);
    if (salesErr) throw salesErr;

    const dd = (s: any) => (s.delivery_date || '').split('T')[0];
    const late = (salesRows || []).filter((s) => dd(s) && dd(s) < today && s.status !== 'delivered');
    const todays = (salesRows || []).filter((s) => dd(s) === today && s.status !== 'delivered');
    const upcoming = (salesRows || [])
      .filter((s) => dd(s) > today && s.status !== 'delivered')
      .sort((a, b) => dd(a).localeCompare(dd(b)));
    const deliveredYesterday = (salesRows || []).filter((s) => {
      if (!s.delivered_at) return false;
      const t = new Date(s.delivered_at).getTime();
      return t >= yesterdayStartMs && t < todayStartMs;
    });

    // ---- ripe to pair (mirrors ops/index.html loadChase()) ----
    const { data: retention, error: retErr } = await sb
      .from('app_customer_retention')
      .select('customer,ripeness_pct,status,days_since_last,avg_litres')
      .in('status', ['due_now', 'overdue']);
    if (retErr) throw retErr;
    const ripe = (retention || []).sort((a, b) => (b.ripeness_pct || 0) - (a.ripeness_pct || 0));

    // ---- lost sales in the last 24h ----
    const { data: lost, error: lostErr } = await sb
      .from('lost_sales')
      .select('customer,est_litres,reason,notes,created_at')
      .gte('created_at', since24h);
    if (lostErr) throw lostErr;

    // ---- health: freshness heartbeat ----
    const salesLast24h = (salesRows || []).filter(
      (s) => s.created_at && new Date(s.created_at).getTime() >= since24hMs
    ).length;

    // ---- health: stuck deliveries (pending, delivery_date > 2 days ago) ----
    const stuckCutoff = daysAgo(2);
    const stuckDeliveries = (salesRows || []).filter(
      (s) => s.status === 'pending' && dd(s) && dd(s) < stuckCutoff
    );

    // ---- health: unresolved TBA pricing (older than 3 days) ----
    const tbaCutoff = daysAgo(3);
    const staleTba = (salesRows || []).filter(
      (s) => s.price_tba && (s.sale_date || '') < tbaCutoff
    );

    // ---- health: customers with no mapped location at all ----
    const { data: allCustomers, error: custErr } = await sb
      .from('customer_locations')
      .select('id,invoice_name');
    if (custErr) throw custErr;
    const { data: allSites, error: sitesErr } = await sb.from('customer_sites').select('customer_id');
    if (sitesErr) throw sitesErr;
    const mappedIds = new Set((allSites || []).map((s) => s.customer_id));
    const unmapped = (allCustomers || []).filter((c) => !mappedIds.has(c.id));

    // ---- build email ----
    const row = (label: string, value: string | number, color = '#1a1a18') =>
      `<tr><td style="padding:4px 0;color:#5a5a57;font-size:13px;">${esc(label)}</td>` +
      `<td style="padding:4px 0;text-align:right;font-weight:700;color:${color};font-family:monospace;font-size:13px;">${esc(value)}</td></tr>`;

    const listBlock = (title: string, items: string[], emptyMsg: string) =>
      `<div style="margin:14px 0;"><div style="font-size:11px;font-weight:700;color:#9a9a97;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${esc(
        title
      )}</div>${
        items.length
          ? items.map((i) => `<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">${i}</div>`).join('')
          : `<div style="color:#9a9a97;font-size:13px;">${esc(emptyMsg)}</div>`
      }</div>`;

    const deliveryLine = (s: any) =>
      `<b>${esc(s.customer)}</b> — ${esc(Math.round(s.litres || 0).toLocaleString())} L ${esc(s.fuel_type || '')}` +
      (s.location ? ` · ${esc(s.location)}` : '') +
      (dd(s) < today ? ` <span style="color:#D4180A;font-weight:700;">(${esc(dd(s))}, late)</span>` : '');

    const ripeLine = (r: any) =>
      `<b>${esc(r.customer)}</b> — <span style="color:${STATUS_COL[r.status] || '#9a9a97'};font-weight:700;">${esc(
        r.status === 'overdue' ? 'Overdue' : 'Due now'
      )}</span> · ${esc(r.ripeness_pct ?? '—')}% ripe · ${esc(r.days_since_last ?? '?')}d since last order`;

    const lostLine = (l: any) =>
      `<b>${esc(l.customer)}</b>${l.est_litres ? ' — ~' + esc(Math.round(l.est_litres).toLocaleString()) + ' L' : ''}` +
      (l.reason ? ` · ${esc(l.reason)}` : '');

    const healthRows =
      row('Sales recorded (last 24h)', salesLast24h, salesLast24h === 0 ? '#D4180A' : '#3B6D11') +
      row('Stuck deliveries (2+ days late, still pending)', stuckDeliveries.length, stuckDeliveries.length ? '#BA7517' : '#3B6D11') +
      row('Unresolved TBA prices (3+ days old)', staleTba.length, staleTba.length ? '#BA7517' : '#3B6D11') +
      row('Customers with no map location', unmapped.length, unmapped.length ? '#BA7517' : '#3B6D11');

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a18;">
  <div style="background:#D4180A;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
    <div style="font-size:17px;font-weight:700;">⛽ Skelsee Ops — Daily Report</div>
    <div style="font-size:12px;opacity:.85;">${esc(today)}</div>
  </div>
  <div style="border:1px solid #E0E0DE;border-top:none;padding:18px 20px;border-radius:0 0 10px 10px;">

    ${listBlock(
      `🚛 Today's deliveries (${late.length + todays.length})`,
      [...late, ...todays].map(deliveryLine),
      'Nothing due today.'
    )}

    ${listBlock(
      `📅 Upcoming deliveries (${upcoming.length})`,
      upcoming.slice(0, 5).map(deliveryLine),
      'Nothing scheduled ahead.'
    )}

    ${listBlock(
      `🌱 Ripe to pair (${ripe.length})`,
      ripe.slice(0, 5).map(ripeLine),
      'Nobody due right now.'
    )}

    ${listBlock('✓ Delivered yesterday', [`<b>${deliveredYesterday.length}</b> deliveries completed`], 'None recorded.')}

    ${listBlock(
      `⚠️ Lost sales (last 24h) (${(lost || []).length})`,
      (lost || []).map(lostLine),
      'None logged.'
    )}

    <div style="margin-top:18px;padding-top:14px;border-top:2px solid #E0E0DE;">
      <div style="font-size:11px;font-weight:700;color:#9a9a97;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">🩺 System health</div>
      <table style="width:100%;border-collapse:collapse;">${healthRows}</table>
      <div style="font-size:10px;color:#9a9a97;margin-top:8px;">
        Note: sales queued offline on a rep's phone aren't visible here until that phone syncs — this only reflects what's already in the database.
      </div>
    </div>

  </div>
</div>`.trim();

    const recipients = (Deno.env.get('REPORT_RECIPIENTS') || 'marketing@skelsee.co.zw')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const from = Deno.env.get('REPORT_FROM') || 'Skelsee Ops <onboarding@resend.dev>';
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY secret is not set');

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: `Skelsee Ops — Daily Report — ${today}`,
        html,
      }),
    });
    const emailResult = await emailRes.json();
    if (!emailRes.ok) throw new Error('Resend error: ' + JSON.stringify(emailResult));

    return new Response(
      JSON.stringify({
        ok: true,
        sent_to: recipients,
        counts: {
          today_deliveries: late.length + todays.length,
          upcoming_deliveries: upcoming.length,
          ripe_to_pair: ripe.length,
          delivered_yesterday: deliveredYesterday.length,
          lost_sales_24h: (lost || []).length,
          sales_last_24h: salesLast24h,
          stuck_deliveries: stuckDeliveries.length,
          stale_tba: staleTba.length,
          unmapped_customers: unmapped.length,
        },
        resend_id: emailResult?.id,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('daily-report failed:', e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
