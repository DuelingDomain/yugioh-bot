// C7: run the rotation helper in a real effect with real place prompts under ASan/UBSan.
// The TypeScript scenarios also run the official Creature Swap card in both game modes.
#include "scripted-duel.h"
#include "card.h"

static void play(int n, bool tag, bool full, bool invalid) {
	const auto setup = n == 2 ? "" : n == 3 ? "Debug.SetupDuelists(3,0,1,2)"
		: tag ? "Debug.SetupDuelists(4,0,1,0,1)" : "Debug.SetupDuelists(4,0,1,2,3)";
	sd::stray_logs = 0;
	int result = -1;
	sd::on_line = [&](const std::string& line) { result = line == "CHK rotated" ? 1 : 0; };
	OCG_Duel d = sd::create(setup);
	for(int p = 0; p < n; ++p) {
		for(int j = 0; j < 20; ++j) sd::add(d, p, 5000, LOCATION_DECK);
		sd::add(d, p, 6000 + p, LOCATION_MZONE, POS_FACEUP_ATTACK, 0);
		for(int j = 1; j < (full ? 5 : 2); ++j)
			sd::add(d, p, 5000, LOCATION_MZONE, POS_FACEUP_DEFENSE, j);
	}
	const std::string operation =
		"local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS);"
		"e:SetCode(EVENT_PHASE_START|PHASE_MAIN1); e:SetCountLimit(1);"
		"e:SetOperation(function() local g=Group.CreateGroup();"
		"for p=0," + std::to_string(invalid ? n - 2 : n - 1) + " do g:AddCard(Duel.GetFieldCard(p,LOCATION_MZONE,0)) end;"
		"Debug.Message(Duel.MPRotateControl(g) and 'CHK rotated' or 'CHK refused') end); Duel.RegisterEffect(e,0)";
	EXPECT(sd::lua(d, operation), "rotation effect loads n=%d", n);
	OCG_StartDuel(d);
	std::vector<sd::Msg> messages;
	const sd::Msg* prompt = nullptr;
	std::vector<int> prompted;
	for(int step = 0; step < 1000 && result < 0; ++step) {
		const int status = sd::step(d, messages, prompt);
		if(result >= 0) break;
		if(status != OCG_DUEL_STATUS_AWAITING) continue;
		EXPECT(prompt != nullptr, "awaiting needs a prompt");
		if(!prompt) break;
		if(prompt->id == MSG_SELECT_PLACE) {
			const uint8_t seat = prompt->p[0];
			prompted.push_back(seat);
			const uint8_t response[] = { seat, LOCATION_MZONE, 0 };
			OCG_DuelSetResponse(d, response, sizeof(response));
		} else if(prompt->id == MSG_SELECT_CHAIN) {
			sd::answer32(d, -1);
		} else {
			EXPECT(false, "unexpected prompt %u before the rotation result", prompt->id);
			break;
		}
	}
	const bool rotates = n > 2 && !tag && !invalid;
	EXPECT(result == static_cast<int>(rotates), "n=%d tag=%d full=%d invalid=%d result=%d", n, tag, full, invalid, result);
	EXPECT(prompted.size() == (rotates ? static_cast<size_t>(n) : 0), "place prompt count %zu", prompted.size());
	for(size_t i = 0; i < prompted.size(); ++i)
		EXPECT(prompted[i] == static_cast<int>(i), "place order %zu is seat %d", i, prompted[i]);
	for(int p = 0; p < n; ++p) {
		auto& f = sd::F(d);
		const auto* received = f.player[p].list_mzone[0];
		const int from = rotates ? (p + n - 1) % n : p;
		EXPECT(received && received->data.code == static_cast<uint32_t>(6000 + from), "seat %d receives seat %d monster", p, from);
		EXPECT(received && received->current.controler == p && received->current.position == POS_FACEUP_ATTACK, "seat %d keeps the received position and controller", p);
		EXPECT(sd::mzone_count(d, p) == (full ? 5 : 2), "seat %d field count", p);
		EXPECT(f.lp_ref(p) == 8000, "seat %d LP", p);
		EXPECT(f.player[p].list_grave.empty() && f.player[p].list_remove.empty(), "seat %d has no lost cards", p);
		for(int j = 1; j < (full ? 5 : 2); ++j) {
			const auto* filler = f.player[p].list_mzone[j];
			EXPECT(filler && filler->data.code == 5000 && filler->current.position == POS_FACEUP_DEFENSE, "seat %d filler zone %d stays", p, j);
		}
	}
	EXPECT(sd::stray_logs == 0, "%d unexpected Lua errors", sd::stray_logs);
	OCG_DestroyDuel(d);
	std::printf("case n=%d tag=%d full=%d invalid=%d checked\n", n, tag, full, invalid);
}

static void unique_keep_choice() {
    sd::scripts[6100] = "local s,id=GetID(); function s.initial_effect(c) c:SetUniqueOnField(1,0,id) end";
    sd::types[6100] = TYPE_MONSTER | TYPE_EFFECT;
    sd::stray_logs = 0;
    bool moved = false;
    sd::on_line = [&](const std::string& line) { moved = line == "CHK unique rotated"; };
    OCG_Duel d = sd::create("Debug.SetupDuelists(3,0,1,2)");
    for(int p = 0; p < 3; ++p) {
        for(int j = 0; j < 20; ++j) sd::add(d, p, 5000, LOCATION_DECK);
        sd::add(d, p, p == 0 ? 6100 : 6000 + p, LOCATION_MZONE, POS_FACEUP_ATTACK, 0);
        sd::add(d, p, p == 1 ? 6100 : 5000, LOCATION_MZONE, POS_FACEUP_DEFENSE, 1);
    }
    auto* incoming = sd::F(d).player[0].list_mzone[0];
    auto* existing = sd::F(d).player[1].list_mzone[1];
    EXPECT(sd::lua(d,
        "local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS);"
        "e:SetCode(EVENT_PHASE_START|PHASE_MAIN1); e:SetCountLimit(1);"
        "e:SetOperation(function() local g=Group.CreateGroup();"
        "for p=0,2 do g:AddCard(Duel.GetFieldCard(p,LOCATION_MZONE,0)) end;"
        "Debug.Message(Duel.MPRotateControl(g) and 'CHK unique rotated' or 'CHK refused') end); Duel.RegisterEffect(e,0)"),
        "unique rotation effect loads");
    OCG_StartDuel(d);
    std::vector<sd::Msg> messages;
    const sd::Msg* prompt = nullptr;
    int places = 0;
    bool hint = false, keep = false, done = false;
    for(int step = 0; step < 1000 && !done; ++step) {
        const int status = sd::step(d, messages, prompt);
        for(const auto& msg : messages) {
            if(msg.id == MSG_HINT && msg.len >= 10 && msg.p[0] == HINT_SELECTMSG && msg.p[1] == 1) {
                uint64_t desc = 0;
                std::memcpy(&desc, msg.p + 2, sizeof(desc));
                if(desc == 534) hint = true; // Stock "Select the card(s) to keep on the field".
            }
        }
        if(status != OCG_DUEL_STATUS_AWAITING) continue;
        EXPECT(prompt != nullptr, "unique case needs a prompt");
        if(!prompt) break;
        if(prompt->id == MSG_SELECT_PLACE) {
            EXPECT(prompt->p[0] == places, "unique move place order %d", places);
            const uint8_t response[] = { prompt->p[0], LOCATION_MZONE, 0 };
            OCG_DuelSetResponse(d, response, sizeof(response));
            ++places;
        } else if(prompt->id == MSG_SELECT_CARD) {
            EXPECT(places == 3 && incoming->current.controler == 1
                && sd::F(d).player[0].list_mzone[0]->data.code == 6002
                && sd::F(d).player[2].list_mzone[0]->data.code == 6001,
                "keep prompt follows the complete move");
            EXPECT(hint && prompt->p[0] == 1, "stock keep hint is for the new controller");
            auto& options = sd::F(d).core.select_cards;
            EXPECT(options.size() == 2, "keep prompt has both unique copies");
            EXPECT(std::find(options.begin(), options.end(), incoming) != options.end(), "incoming copy is offered");
            EXPECT(std::find(options.begin(), options.end(), existing) != options.end(), "existing copy is offered");
            const auto it = std::find(options.begin(), options.end(), incoming);
            if(it == options.end()) break;
            const int32_t response[] = { 0, 1, static_cast<int32_t>(it - options.begin()) };
            OCG_DuelSetResponse(d, response, sizeof(response));
            keep = true;
        } else if(prompt->id == MSG_SELECT_CHAIN) {
            sd::answer32(d, -1);
        } else if(prompt->id == MSG_SELECT_IDLECMD) {
            done = true;
        } else {
            EXPECT(false, "unexpected unique prompt %u", prompt->id);
            break;
        }
    }
    EXPECT(moved && places == 3 && keep && done, "unique rotation reaches the keep choice and final board");
    for(int p = 0; p < 3; ++p) {
        auto& player = sd::F(d).player[p];
        EXPECT(sd::mzone_count(d,p) == (p == 1 ? 1 : 2), "unique final field count seat %d", p);
        EXPECT(sd::szone_count(d,p) == 0 && player.list_remove.empty(), "unique spell and banished fields seat %d", p);
        EXPECT(sd::F(d).lp_ref(p) == 8000, "unique final LP seat %d", p);
        EXPECT(player.list_grave.size() == (p == 1 ? 1u : 0u), "unique final Graveyard seat %d", p);
        if(p == 1) {
            EXPECT(player.list_mzone[0] == incoming && player.list_mzone[1] == nullptr, "new controller keeps incoming copy in m0");
            EXPECT(player.list_grave.size() == 1 && player.list_grave.front() == existing, "other copy goes to its owner's Graveyard");
        } else {
            const auto* received = player.list_mzone[0];
            EXPECT(received && received->data.code == static_cast<uint32_t>(p == 0 ? 6002 : 6001), "unique rotation destination seat %d", p);
            EXPECT(player.list_mzone[1] && player.list_mzone[1]->data.code == 5000, "unique filler stays seat %d", p);
        }
    }
    EXPECT(sd::stray_logs == 0, "%d unique case Lua errors", sd::stray_logs);
    OCG_DestroyDuel(d);
    sd::scripts.erase(6100);
    sd::types.erase(6100);
    std::printf("case FFA3 unique keep choice checked\n");
}

int main() {
	for(int n : {3, 4}) {
		play(n, false, false, false);
		play(n, false, true, false);
		play(n, false, true, true);
	}
	play(4, true, true, false);
	play(2, false, true, false);
	unique_keep_choice();
	std::printf("rotate-control: %s (%d failures)\n", failures ? "FAIL" : "PASS", failures);
	return failures ? 1 : 0;
}
