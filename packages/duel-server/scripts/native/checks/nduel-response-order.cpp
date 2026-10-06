// Exercise the actual nightly checker, not a second implementation of it.
// FFA4 seed 18 at 3000 LP: seat 3 pays its last LP for Cosmic Cyclone,
// its sole link is removed, and CHAIN_END arrives without CHAIN_SOLVING.
// Later open windows must not be checked against that removed link.
#include "../nduel.cpp"
