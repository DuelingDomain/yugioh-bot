# Effect search final review fixes

Follow the owner's four fixes in order. Use Node 22.23.3, `prlimit --core=0`,
and the no-env-file preload. Use targeted integration tests only. Do not change
engine data. Make one commit per fix, with the required author/session trailers.

1. Reproduce the slow ledger leak with SQLite, HTTP and a durable ledger.
   Give each ledger read/write 10 seconds and the paid request 2 seconds.
   Release pre-call reservations, including uncertain writes; let live CI
   expire only runtime `reserved` rows older than one hour. Test both paths.
2. Require the runtime ledger token. Test that GITHUB_TOKEN alone cannot enable
   the reader. Record exact owner token and branch-protection steps in docs
   and the PR body. Do not create or expose any token.
3. Verify and spool artifact files before acquiring the SQLite write lock.
   Skip artifact imports on flag-off duel boot. Test the file/lock boundary
   and measure first/repeat imports on a database copy.
4. Restore the prior random pick policy when effect search is off. Keep the
   scorer on. Test bot and expired-pick paths with the flag on and off.
5. Push effect-search; merge into both dependent branches and push them.
   Poll PR 412 CI text every two minutes and fix branch-caused failures.
6. Port the fixes to local-all. Build before replacing duel dist. Build and
   package the web output; stop web, rsync, start web, restart duel. Keep the
   preload. Verify HTTP and services, then remove disposable build output.
