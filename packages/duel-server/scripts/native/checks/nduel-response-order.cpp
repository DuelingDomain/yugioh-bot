// Exercise the nightly driver's shared checker with synthetic windows and a real duel.
#include "../response-order.h"
#include <cstdio>
#include <cstdlib>

static void require(bool condition, const char* detail) {
	if(!condition) {
		std::fprintf(stderr, "FAIL response-order regression: %s\n", detail);
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
// Keep the driver's local IDs separate from the internal headers used by the fixture.
#define MSG_DUELIST_ELIMINATED NDUEL_MSG_DUELIST_ELIMINATED
#define MSG_ATTACK_DUELIST NDUEL_MSG_ATTACK_DUELIST
#define MSG_FIELD_DISABLED_N NDUEL_MSG_FIELD_DISABLED_N
#include "../nduel.cpp"
#undef MSG_DUELIST_ELIMINATED
#undef MSG_ATTACK_DUELIST
#undef MSG_FIELD_DISABLED_N
#undef main
#include "scripted-duel.h"

// A changing released-card pool can change the seeded driver's decks and answers.
// Force this coverage in a real duel instead of relying on a random Cosmic Cyclone.
static void final_link_elimination() {
	sd::scripts[101] = R"(
function c101.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_QUICK_O)
 e:SetCode(EVENT_FREE_CHAIN)
 e:SetRange(LOCATION_HAND)
 e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.GetLP(tp)>0 and Duel.CheckLPCost(tp,Duel.GetLP(tp)) end
  Duel.PayLPCost(tp,Duel.GetLP(tp))
 end)
 e:SetOperation(function(e,tp) end)
 c:RegisterEffect(e)
end
)";
	sd::scripts[102] = R"(
function c102.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_QUICK_O)
 e:SetCode(EVENT_FREE_CHAIN)
 e:SetRange(LOCATION_HAND)
 e:SetOperation(function(e,tp) end)
 c:RegisterEffect(e)
end
)";
	sd::types[101] = sd::types[102] = TYPE_MONSTER | TYPE_EFFECT;
	OCG_Duel d = sd::create("Debug.SetupDuelists(4,0,1,2,3)", static_cast<uint32_t>(opt.seed));
	for(int seat = 0; seat < 4; ++seat) {
		sd::F(d).lp_ref(seat) = opt.lp;
		for(int i = 0; i < 40; ++i) sd::add(d, seat, 1, LOCATION_DECK);
		sd::add(d, seat, seat == 3 ? 101 : 102, LOCATION_HAND);
	}
	OCG_StartDuel(d);
	ResponseOrder check(4, false);
	int turn_player = -1;
	const int empty_ends_before = empty_ends;
	bool paid = false, eliminated = false, ended = false, boundary = false;
	std::vector<int> open_prompts;
	std::vector<sd::Msg> msgs;
	auto checked = [](const std::string& error) { require(error.empty(), error.c_str()); };
	for(int step = 0; step < 1000 && !boundary; ++step) {
		const sd::Msg* prompt = nullptr;
		const int status = sd::step(d, msgs, prompt);
		for(const auto& msg : msgs) {
			Reader mr(msg.p, msg.len, msg.id);
			switch(msg.id) {
			case MSG_NEW_TURN: turn_player = mr.get<uint8_t>(); break;
			case MSG_CHAINING:
				mr.skip(4 + 10);
				checked(check.chaining(mr.get<uint8_t>(), turn_player));
				break;
			case MSG_DUELIST_ELIMINATED:
				require(mr.get<uint8_t>() == 3, "fixture eliminated the wrong seat");
				checked(check.eliminate(3, turn_player));
				eliminated = true;
				break;
			case MSG_CHAIN_SOLVING:
				require(!eliminated, "fixture resolved the removed final link");
				checked(check.solving(turn_player));
				break;
			case MSG_CHAIN_END:
				observe_chain_end(check);
				checked(check.end(turn_player));
				ended = true;
				break;
			case MSG_SELECT_CHAIN: {
				const int seat = mr.get<uint8_t>(), spe_count = mr.get<uint8_t>();
				check.prompt(seat, spe_count);
				if(ended && (sd::F(d).core.hint_timing[seat] & TIMING_CHAIN_END)) open_prompts.push_back(seat);
				break;
			}
			case MSG_NEW_PHASE: case MSG_SELECT_IDLECMD:
				if(ended) boundary = true;
				break;
			}
		}
		if(boundary || status == OCG_DUEL_STATUS_END) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		require(prompt != nullptr, "fixture awaited a response without a prompt");
		if(prompt->id == MSG_SELECT_CHAIN) {
			const bool activate = !paid && prompt->p[0] == 3;
			if(activate) paid = true;
			sd::answer32(d, activate ? 0 : -1);
		} else {
			require(false, "fixture reached an unexpected prompt before cleanup");
		}
	}
	require(paid && eliminated && ended && boundary, "fixture did not exercise final-link elimination followed by cleanup");
	require(empty_ends == empty_ends_before + 1, "fixture did not observe exactly one open-anchor CHAIN_END");
	require(open_prompts == std::vector<int>{0, 1, 2}, "fixture did not restart one turn-player-first open round after CHAIN_END");
	OCG_DestroyDuel(d);
	std::puts("response-order final-link fixture passed");
}
#endif

int main(int argc, char** argv) {
	synthetic_checks();
#ifndef NDUEL_RESPONSE_ORDER_UNIT
	const int status = nduel_main(argc, argv);
	final_link_elimination();
	return status;
#else
	(void)argc; (void)argv;
	std::puts("response-order synthetic checks passed");
#endif
}
