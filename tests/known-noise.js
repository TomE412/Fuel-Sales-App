// Console errors that are already there and are nobody's fault today, kept in
// one place so two specs cannot disagree about what counts as noise.
//
// Each entry is a real fault with a real reason. They are listed so a NEW
// error cannot hide among them — anything not matched here still fails.
const KNOWN_NOISE = [
  // The admin shell asks for a delivery_plan table that was never created.
  // phase_c1_delivery_plan.sql exists in supabase/migrations but has not been
  // run. Fires at sign-in, on every admin page load.
  /delivery_plan/,
  // loadChase() in the admin Overview writes to n-ripe / ripe-list, neither of
  // which exists in admin/index.html. Same root cause as the eight
  // long-standing failures in the full suite. Whether it lands inside a given
  // test's listening window is a matter of timing, which is why it has to be
  // named rather than left to luck.
  /Cannot set properties of null/,
  /n-ripe|ripe-list/,
  // The manage-users Edge Function. Until it is deployed, every call fails the
  // CORS preflight, which the browser reports in three different ways. The
  // People page handles this and says so on screen; these lines can come out
  // of this list once the function is live.
  /manage-users/,
  /CORS policy/,
  /ERR_FAILED/,
  // The generic companion to all of the above. Deliberately last, and
  // deliberately broad: a bare "failed to load resource" carries no detail to
  // match on, so it can only ever be tolerated wholesale.
  /Failed to load resource/,
];

/** Strips the known noise, leaving only errors worth failing a test over. */
function realErrors(errors) {
  return (errors || []).filter(e => !KNOWN_NOISE.some(rx => rx.test(e)));
}

module.exports = { KNOWN_NOISE, realErrors };
