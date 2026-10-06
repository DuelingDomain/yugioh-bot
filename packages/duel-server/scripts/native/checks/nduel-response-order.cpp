// Exercise the nightly driver's shared checker with synthetic windows and a real duel.
#include "../response-order.h"
#include <cstdio>
#include <cstdlib>

static void require(bool condition, const char* detail) {
	if(!condition) {
		std::fprintf(stderr, "response-order regression: %s\n", detail);
		std::exit(1);
	}
}

static void synthetic_checks() {
	{
		ResponseOrder check(4, false);
		check.chaining(3, 2);
		check.prompt(0); check.prompt(2); check.prompt(1);
		require(!check.end(2).empty(), "CHAIN_END discarded invalid collected responses");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 2);
		check.eliminate(3, 2);
		require(check.chain_L == -1 && check.emptied_by_elimination, "final link elimination did not open the anchor");
		check.prompt(0); check.prompt(2); check.prompt(1);
		require(!check.end(2).empty(), "empty chain accepted stale-anchor order before END");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 2);
		check.eliminate(3, 2);
		check.prompt(2); check.prompt(0); check.prompt(1);
		require(!check.end(2).empty(), "empty chain accepted a redundant correctly ordered pre-END round");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 2); check.eliminate(3, 2);
		check.prompt(3, 0x7f);
		require(check.end(2).empty(), "empty chain rejected cleanup END without response prompts");
		check.prompt(1); check.prompt(0); check.prompt(2);
		require(check.chaining(0, 2).empty(), "prompts after END leaked into the old window");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(1, 0); check.chaining(3, 0);
		check.eliminate(3, 0);
		require(check.chain_L == 1, "eliminated top link did not restore the living lower anchor");
		check.prompt(2); check.prompt(0); check.prompt(1);
		require(check.solving(0).empty(), "living lower link rejected valid response order");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(1, 0); check.chaining(3, 0);
		check.eliminate(3, 0);
		check.prompt(0); check.prompt(1); check.prompt(2);
		require(!check.end(0).empty(), "living lower link accepted eliminated top's response order");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(1, 0); check.chaining(3, 0); check.chaining(1, 0);
		check.eliminate(1, 0);
		require(check.owners == std::vector<int>{3}, "elimination did not remove all links owned by the seat");
		check.prompt(0); check.prompt(2);
		require(check.solving(0).empty(), "partial response sequence was rejected");
		check.eliminate(3, 0);
		require(!check.emptied_by_elimination, "elimination after resolution reopened a response window");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 2);
		check.prompt(0); check.prompt(2); check.prompt(1);
		require(!check.eliminate(3, 2).empty(), "elimination discarded already collected invalid responses");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 2); check.eliminate(3, 2);
		check.prompt(2); check.prompt(2);
		require(!check.end(2).empty(), "duplicate prompts passed the open window check");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 0);
		check.prompt(0); check.prompt(1);
		check.eliminate(2, 0); // No link was removed, so this is the same round.
		check.prompt(0);
		require(!check.end(0).empty(), "irrelevant elimination discarded response history");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 0);
		check.prompt(2);
		check.eliminate(2, 0);
		check.prompt(0);
		require(!check.end(0).empty(), "eliminating a previously prompted seat erased the round position");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(1, 0); check.chaining(3, 0);
		check.prompt(0); check.prompt(1);
		require(check.eliminate(1, 0).empty(), "valid pre-elimination prompts were rejected");
		require(check.chain_L == 3, "removing a lower link changed the living top anchor");
		check.prompt(0); check.prompt(2); check.prompt(3);
		require(check.end(0).empty(), "lower-link removal did not restart the response round");
	}
	{
		ResponseOrder check(4, false);
		check.chaining(3, 3); check.eliminate(3, 3);
		require(check.chaining(0, 3).empty(), "new link without a response prompt was rejected");
		require(!check.emptied_by_elimination, "new living link retained the empty-chain flag");
		check.prompt(1); check.prompt(2); check.prompt(0);
		require(check.end(3).empty(), "new living link did not restore response validation");
	}
	{
		ResponseOrder check(4, true);
		check.chaining(0, 0);
		check.prompt(0, 0x7f);
		for(int p : {1, 3, 2, 0}) check.prompt(p);
		require(check.solving(0).empty(), "Tag order or own-link trigger exclusion changed");
		check.chaining(0, 0);
		for(int p : {1, 2, 3, 0}) check.prompt(p);
		require(!check.end(0).empty(), "Tag accepted clockwise FFA order");
	}
	{
		ResponseOrder check(2, false);
		check.chaining(0, 0);
		check.prompt(0); check.prompt(1); check.prompt(0);
		require(check.end(0).empty(), "multiplayer check ran for n2");
	}
}

#ifndef NDUEL_RESPONSE_ORDER_UNIT
static int empty_ends = 0;
static void observe_chain_end(const ResponseOrder& check) {
	if(check.emptied_by_elimination) {
		require(check.chain_L == -1 && check.owners.empty() && check.collecting,
		        "CHAIN_END after final-link elimination did not have an open tracked anchor");
		++empty_ends;
	}
}
#define NDUEL_CHAIN_END_HOOK observe_chain_end
#define main nduel_main
#include "../nduel.cpp"
#undef main
#endif

int main(int argc, char** argv) {
	synthetic_checks();
#ifndef NDUEL_RESPONSE_ORDER_UNIT
	const int status = nduel_main(argc, argv);
	require(empty_ends > 0, "seed did not exercise final-link elimination followed by CHAIN_END");
	return status;
#else
	(void)argc; (void)argv;
	std::puts("response-order synthetic checks passed");
#endif
}
