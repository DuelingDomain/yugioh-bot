# Domain proof patches

These patches are proposals. They are not in the installed patch series.
Apply them to P61, in this order:

1. `remove-eliminated-chain-cards.patch`
2. `tag-partner-synchro/tag-partner-synchro.patch`
3. `synchro-effect-order/synchro-effect-order.patch`

The second patch is the existing Tag audit patch, copied without changes.
The third patch keeps its effect checks in the stock two-seat order. Do not
apply the second patch without the third patch.

The tests use the private Domain build under
`domain-core/.build/phase1/gap-domain/`. Its base core commit is
`adff5f1`. The tested head is `538916e`. The build uses the pinned Domain
layer and the local Emscripten 4.0.9 image, with the host user ID. The tested
wasm SHA256 is
`a695f5e895dc31745c54aad73fbe417874942e3ae750c6f381d4d2e913915abe`.

Live tests need both `NSEAT_WASM` and `DOMAIN_MULTI_WASM` set to the private
wasm. Direct core tests use the second variable. They fail on P61 for the
known defects. The frozen script overlay comes from commit `a3297e3`.

See `docs/specs/2026-10-01-domain-nseat-stress.md` for rules, results, and
limits. Build files are removed after proof. The exported patches, commit
messages, and proof record remain in `gap-domain/out`.
