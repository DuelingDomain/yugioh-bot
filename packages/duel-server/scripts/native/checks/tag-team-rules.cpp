// Native check: two Tag team rules that a raw seat compare broke (gap hunt for the area "tag").
//
// A  [R-TAG-PARTNER-COST] A monster of the Tag partner is a Synchro material of the team. card::is_can_be_synchro_material compared
//    the raw controller of the material with the controller of the Synchro monster, so the partner was refused. With more than
//    two duelists the test is now "same team". Probed straight on the core call, with real card types (Tuner, Synchro):
//      synchro-tag-team0   seat 0 Synchro: own monster yes, partner (seat 2) yes, opponents (seats 1 and 3) no
//      synchro-tag-team1   seat 1 Synchro: own yes, partner (seat 3) yes, opponents (seats 0 and 2) no
//      synchro-ffa3        seat 0 Synchro: own yes, no other seat (there is no partner in free for all)
//      synchro-1v1         2 duelists (stock): own yes, the opponent no
//      synchro-effect      a monster with EFFECT_SYNCHRO_MATERIAL is still taken from any field (stock rule kept), in Tag too
//
#include "scripted-duel.h"
#include "card.h"

static const uint32_t kFiller = 5000, kTuner = 6000, kPlain = 6001, kSynchro = 6002, kAttacker = 6003, kMat = 6004;

struct Board {
	OCG_Duel d = nullptr;
	explicit Board(const std::string& setup, int n, const std::vector<std::pair<int, uint32_t>>& mzone, const std::vector<std::pair<int, uint32_t>>& extra = {}) {
		sd::types[kTuner] = TYPE_MONSTER | TYPE_NORMAL | TYPE_TUNER;
		sd::types[kPlain] = TYPE_MONSTER | TYPE_NORMAL;
		sd::types[kSynchro] = TYPE_MONSTER | TYPE_EFFECT | TYPE_SYNCHRO;
		sd::types[kAttacker] = TYPE_MONSTER | TYPE_NORMAL;
		sd::types[kMat] = TYPE_MONSTER | TYPE_NORMAL;
		d = sd::create(setup);
		for(int p = 0; p < n; ++p)
			for(int i = 0; i < 20; ++i) sd::add(d, static_cast<uint8_t>(p), kFiller, LOCATION_DECK);
		int seq[4] = { 0, 0, 0, 0 };
		for(const auto& [seat, code] : mzone) sd::add(d, static_cast<uint8_t>(seat), code, LOCATION_MZONE, POS_FACEUP_ATTACK, static_cast<uint32_t>(seq[seat]++));
		for(const auto& [seat, code] : extra) sd::add(d, static_cast<uint8_t>(seat), code, LOCATION_EXTRA, POS_FACEDOWN_DEFENSE);
		OCG_StartDuel(d);
	}
	~Board() { OCG_DestroyDuel(d); }
	card* mz(int seat, uint32_t code) {
		for(auto* c : sd::F(d).player[seat].list_mzone)
			if(c && c->data.code == code) return c;
		return nullptr;
	}
	card* extra(int seat, uint32_t code) {
		for(auto* c : sd::F(d).player[seat].list_extra)
			if(c && c->data.code == code) return c;
		return nullptr;
	}
};

static bool can_mat(Board& b, int sc_seat, int mat_seat, uint32_t mat_code) {
	card* sc = b.extra(sc_seat, kSynchro);
	card* mat = b.mz(mat_seat, mat_code);
	if(!sc || !mat) { std::printf("FAIL: board is missing a card (seat %d / %d)\n", sc_seat, mat_seat); ++failures; return false; }
	return mat->is_can_be_synchro_material(sc, static_cast<uint8_t>(sc_seat), nullptr) != 0;
}

static void synchro() {
	const std::string tag = "Debug.SetupDuelists(4,0,1,0,1)", ffa3 = "Debug.SetupDuelists(3,0,1,2)";
	{
		Board b(tag, 4, { {0, kTuner}, {1, kMat}, {2, kPlain}, {3, kMat} }, { {0, kSynchro} });
		EXPECT(can_mat(b, 0, 0, kTuner), "synchro-tag-team0: the own Tuner must be a material");
		EXPECT(can_mat(b, 0, 2, kPlain), "synchro-tag-team0: the monster of the partner (seat 2) must be a material");
		EXPECT(!can_mat(b, 0, 1, kMat), "synchro-tag-team0: the monster of seat 1 (an opponent) must not be a material");
		EXPECT(!can_mat(b, 0, 3, kMat), "synchro-tag-team0: the monster of seat 3 (an opponent) must not be a material");
		std::printf("ok   synchro-tag-team0\n");
	}
	{
		Board b(tag, 4, { {0, kMat}, {1, kPlain}, {2, kMat}, {3, kTuner} }, { {1, kSynchro} });
		EXPECT(can_mat(b, 1, 1, kPlain), "synchro-tag-team1: the own monster must be a material");
		EXPECT(can_mat(b, 1, 3, kTuner), "synchro-tag-team1: the Tuner of the partner (seat 3) must be a material");
		EXPECT(!can_mat(b, 1, 0, kMat), "synchro-tag-team1: the monster of seat 0 (an opponent) must not be a material");
		EXPECT(!can_mat(b, 1, 2, kMat), "synchro-tag-team1: the monster of seat 2 (an opponent) must not be a material");
		std::printf("ok   synchro-tag-team1\n");
	}
	{
		Board b(ffa3, 3, { {0, kTuner}, {1, kMat}, {2, kPlain} }, { {0, kSynchro} });
		EXPECT(can_mat(b, 0, 0, kTuner), "synchro-ffa3: the own Tuner must be a material");
		EXPECT(!can_mat(b, 0, 1, kMat), "synchro-ffa3: the monster of seat 1 must not be a material");
		EXPECT(!can_mat(b, 0, 2, kPlain), "synchro-ffa3: the monster of seat 2 must not be a material");
		std::printf("ok   synchro-ffa3\n");
	}
	{
		Board b("", 2, { {0, kTuner}, {1, kMat} }, { {0, kSynchro} });
		EXPECT(can_mat(b, 0, 0, kTuner), "synchro-1v1: the own Tuner must be a material");
		EXPECT(!can_mat(b, 0, 1, kMat), "synchro-1v1: the monster of the opponent must not be a material");
		std::printf("ok   synchro-1v1\n");
	}
	{
		// EFFECT_SYNCHRO_MATERIAL (a monster that any Synchro Monster may take from the field of the opponent) keeps working.
		Board b(tag, 4, { {0, kTuner}, {1, kMat}, {2, kPlain}, {3, kPlain} }, { {0, kSynchro} });
		sd::lua(b.d, "local c=Duel.GetFieldGroup(1,LOCATION_MZONE,0):GetFirst()\n"
		             "local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_SINGLE) e:SetCode(EFFECT_SYNCHRO_MATERIAL) c:RegisterEffect(e)");
		EXPECT(can_mat(b, 0, 1, kMat), "synchro-effect: a monster with EFFECT_SYNCHRO_MATERIAL of an opponent must stay a material");
		EXPECT(!can_mat(b, 0, 3, kPlain), "synchro-effect: the other opponent monster must still not be a material");
		std::printf("ok   synchro-effect\n");
	}
}

int main(int argc, char** argv) {
	(void)argc; (void)argv;
	synchro();
	std::printf("%s: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
