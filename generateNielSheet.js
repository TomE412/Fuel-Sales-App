// ============================================================================
//  generateNielSheet.js  —  Carrie commission export (Skelsee)
//  Reads sales from Supabase, writes Niel's exact "New contract" layout with
//  LIVE formulas, leaves Cost Price blank for Niel. Loss deals auto-floor at
//  half a cent/L. Requires SheetJS (xlsx) loaded on the page.
//
//  Usage:
//     const sales = await fetchMonthSales(supabase, '2026-06'); // your query
//     generateNielSheet(sales, { monthLabel: 'JUNE 2026' });
// ============================================================================

// Location -> one-way distance (km). Transport auto-doubles for round trip.
// Add every delivery location you use here (mirror of Niel's "Distance calc").
const DISTANCE_BY_LOCATION = {
  "Mapinga": 90, "Norton": 66, "Chikurubi Prison Farm": 10, "Arcturus rd": 10,
  "Mhangura": 210, "Sengwa": 352, "Bindura": 112, "Harare": 10, "Silobela": 0,
  // ...extend as needed
};

const PRICE_PER_KM = 2.2;   // haulage $/km (round trip auto-applied)
const LOSS_FLOOR   = 0.005; // $/L paid when a deal makes a loss (confirm w/ Niel)
const RETAINER     = 1200;  // monthly retainer $

// --- helpers ----------------------------------------------------------------
const col = n => { let s=""; while(n>0){ s=String.fromCharCode(65+(n-1)%26)+s; n=Math.floor((n-1)/26);} return s; };
const addr = (r,c) => col(c)+r;

function generateNielSheet(sales, opts = {}) {
  const monthLabel = opts.monthLabel || "";
  const ws = {};
  const set = (r,c,cell) => { ws[addr(r,c)] = cell; };
  const S = v => ({ t:"s", v:String(v) });                 // string cell
  const N = (v,fmt) => ({ t:"n", v:v, ...(fmt?{z:fmt}:{}) });// number cell
  const F = (f,fmt) => ({ t:"n", f:f, ...(fmt?{z:fmt}:{}) });// formula cell

  // Title + assumptions
  set(1,1,S(`CARRIE — MONTHLY COMMISSION  |  Niel's structure (eff. 1 June 2026)  |  ${monthLabel}`));
  set(2,1,S("From Supabase. Niel fills ONLY the yellow Cost Price. Loss deals auto-pay the half-cent floor. All sales included."));
  set(3,1,S("Price per km ($):")); set(3,2,N(PRICE_PER_KM,"0.00"));
  set(3,4,S("Loss floor ($/L):")); set(3,5,N(LOSS_FLOOR,"0.0000"));
  set(3,6,S("Monthly retainer ($):")); set(3,8,N(RETAINER,"$#,##0"));

  const headers = ["Date","Customer","Volume","Cost Price","Distance","Transport","Total Cost",
    "Selling Price","Margin","Company GP Cent1 (60%)","Company Value Cent1","Carrie GP Cent1 (40%)",
    "Carrie Value Cent1","Company GP Cent2 (75%)","Company Value Cent2","Carrie GP Cent2 (25%)",
    "Carrie Value Cent2","Company GP Cent3 (50%)","Company Value Cent3","Carrie GP Cent3 (50%)",
    "Carrie Value Cent3","Total Company GP Value","Total Carrie Commission","Paid?"];
  const HR = 5;
  headers.forEach((h,i)=> set(HR,i+1,S(h)));

  const $ = "$#,##0.00;($#,##0.00);-", D4="0.0000";
  const r0 = HR+1;
  sales.forEach((sale,k) => {
    const r = r0+k;
    const dist = DISTANCE_BY_LOCATION[sale.location] ?? 0; // 0 => transport 0; fix the map if this hits
    const g = f => `IF($D${r}="","",${f})`;                // blank until Niel enters cost
    const I=`I${r}`, C=`C${r}`;
    const t1=`MIN(${I},0.01)`, t2=`MAX(0,MIN(${I},0.02)-0.01)`, t3=`MAX(0,${I}-0.02)`;

    set(r,1,S(sale.date));                    // Date (string label from Supabase)
    set(r,2,S(sale.customer));                // Customer
    set(r,3,N(sale.litres,"#,##0"));          // Volume
    set(r,4,{t:"n", z:D4, s:{fill:{fgColor:{rgb:"FFFF00"}}}}); // Cost Price (blank, yellow)
    set(r,5,N(dist));                         // Distance
    set(r,6,F(`E${r}*$B$3*2/C${r}`,D4));      // Transport (round trip / litres)
    set(r,7,F(g(`$D${r}+F${r}`),D4));         // Total Cost
    set(r,8,N(sale.sell_price,D4));           // Selling Price
    set(r,9,F(g(`H${r}-G${r}`),D4));          // Margin
    set(r,10,F(g(`0.6*${t1}`),D4)); set(r,11,F(g(`J${r}*${C}`),$));
    set(r,12,F(g(`0.4*${t1}`),D4)); set(r,13,F(g(`L${r}*${C}`),$));
    set(r,14,F(g(`0.75*${t2}`),D4)); set(r,15,F(g(`N${r}*${C}`),$));
    set(r,16,F(g(`0.25*${t2}`),D4)); set(r,17,F(g(`P${r}*${C}`),$));
    set(r,18,F(g(`0.5*${t3}`),D4));  set(r,19,F(g(`R${r}*${C}`),$));
    set(r,20,F(g(`0.5*${t3}`),D4));  set(r,21,F(g(`T${r}*${C}`),$));
    set(r,22,F(g(`K${r}+O${r}+S${r}`),$));
    // Floor-aware Carrie total: loss -> half-cent/L, else tier sum
    set(r,23,F(g(`IF(I${r}<0,$E$3*C${r},M${r}+Q${r}+U${r})`),$));
    set(r,24,S(sale.paid ? "Yes" : "No"));    // Paid? (info only)
  });

  const last = r0 + sales.length - 1, tr = last+1;
  set(tr,2,S("MONTH TOTAL (all sales)"));
  set(tr,22,F(`SUM(V${r0}:V${last})`,$));
  set(tr,23,F(`SUM(W${r0}:W${last})`,$));

  const s = tr+2;
  set(s,2,S("Total commission (all sales, floor applied):")); set(s,7,F(`W${tr}`,$));
  set(s+1,2,S("Plus monthly retainer:"));                     set(s+1,7,F(`$H$3`,$));
  set(s+2,2,S("TOTAL PAYABLE TO CARRIE:"));                   set(s+2,7,F(`G${s}+G${s+1}`,$));

  ws["!ref"] = `A1:${addr(s+2,24)}`;
  ws["!cols"] = [{wch:9},{wch:18},{wch:10},{wch:11},{wch:9},{wch:10},{wch:11},{wch:11},{wch:10},
    {wch:11},{wch:12},{wch:11},{wch:12},{wch:11},{wch:12},{wch:11},{wch:12},{wch:11},{wch:12},
    {wch:11},{wch:12},{wch:13},{wch:14},{wch:7}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "New contract");
  XLSX.writeFile(wb, `Carrie_Commission_${monthLabel.replace(/\s+/g,"_")||"export"}.xlsx`);
}
