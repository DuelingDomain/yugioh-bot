// Real candidate scripts on the native multiplayer core. Only card data for the
// test's inert hand/deck cards is synthetic, as in declared-field-payments.cpp.
// R-COMMON-OPP-PICK / R-FFA-OPP-ONE: exactly one opponent's hand.
// R-COMMON-SEAT-STATE: Acropolis declarations are per FFA seat / Tag team.
#include "scripted-duel.h"
#include "card.h"
#include "interpreter.h"

static constexpr uint32_t mind = 15800838, designator = 33423043, acropolis = 74733322;
static constexpr uint32_t named = 91990, other = 91991, cost = 91992;
static uint32_t u32(const uint8_t* p) { uint32_t v; std::memcpy(&v, p, 4); return v; }
static std::string setup(int n, bool tag) {
    return n == 3 ? "Debug.SetupDuelists(3,0,1,2)" : tag ? "Debug.SetupDuelists(4,0,1,0,1)" : "Debug.SetupDuelists(4,0,1,2,3)";
}
static bool has(const std::vector<card*>& cards, uint32_t code) {
    return std::any_of(cards.begin(), cards.end(), [=](card* c) { return c->data.code == code; });
}
static void flow(int n, bool tag, uint32_t code, bool hit) {
    const int before = failures, victim = n - 1;
    sd::stray_logs = 0;
    auto d = sd::create(setup(n, tag), 1, true);
    auto& f = sd::F(d);
    for(int p = 0; p < n; ++p) {
        f.player[p].start_count = 0;
        f.player[p].draw_count = 0;
        for(int i = 0; i < 10; ++i) sd::add(d, p, other, LOCATION_DECK);
        sd::add(d, p, named, LOCATION_HAND);
        sd::add(d, p, named, LOCATION_HAND);
    }
    sd::add(d, 0, code, code == mind ? LOCATION_SZONE : LOCATION_HAND);
    OCG_StartDuel(d);
    bool activated = false, finished = false;
    int picks = 0, announcements = 0;
    for(int step = 0; step < 300 && !finished; ++step) {
        std::vector<sd::Msg> msgs; const sd::Msg* ignored = nullptr;
        if(sd::step(d, msgs, ignored) != OCG_DUEL_STATUS_AWAITING) continue;
        if(msgs.empty()) break;
        const auto& m = msgs.back(); const auto* p = m.p;
        if(std::getenv("CHECK_LOG")) std::fprintf(stderr, "card=%u prompt=%u seat=%u\n", code, m.id, p[0]);
        switch(m.id) {
        case MSG_SELECT_IDLECMD:
            if(activated) { finished = true; break; }
            activated = true; sd::answer32(d, 5); break;
        case MSG_SELECT_CHAIN: sd::answer32(d, -1); break;
        case MSG_SELECT_OPTION: {
            ++picks;
            std::vector<int> seats;
            for(int i = 0; i < p[1]; ++i) {
                uint64_t desc; std::memcpy(&desc, p + 2 + 8*i, 8);
                EXPECT((desc >> 16) == 0xFFFE, "expected opponent declaration");
                seats.push_back(desc & 0xff);
            }
            const std::vector<int> expected = tag ? std::vector<int>{1,3} : n == 3 ? std::vector<int>{1,2} : std::vector<int>{1,2,3};
            EXPECT(seats == expected && announcements == 0, "declare living opponents before announcement; exclude Tag partner");
            sd::answer32(d, static_cast<int>(seats.size()) - 1); break;
        }
        case MSG_ANNOUNCE_CARD:
            ++announcements;
            EXPECT(p[0] == 0 && picks == 1, "activator announces after opponent pick");
            sd::answer32(d, hit ? named : other); break;
        case MSG_SELECT_CARD: {
            // D.D. Designator chooses one copy in the declared opponent's hand.
            for(uint32_t i = 0; i < u32(p + 10); ++i)
                EXPECT(p[14 + 14*i + 4] == victim, "selection leaked into another hand");
            const uint32_t answer[] = {0,1,0}; OCG_DuelSetResponse(d, answer, sizeof(answer)); break;
        }
        case MSG_SELECT_PLACE: {
            const uint8_t answer[] = {0, LOCATION_SZONE, 0}; OCG_DuelSetResponse(d, answer, sizeof(answer)); break;
        }
        default: EXPECT(false, "unexpected prompt %u", m.id); finished = true; break;
        }
    }
    EXPECT(finished && picks == 1 && announcements == 1, "card %u completed n%d tag%d hit%d", code,n,tag,hit);
    for(int p = 0; p < n; ++p) {
        const int removed = hit ? (p == victim ? (code == mind ? 2 : 1) : 0) : (p == 0 ? 1 : 0);
        EXPECT(int(f.player[p].list_hand.size()) == 2 - removed, "card %u seat%d hand size",code,p);
        const auto& destination = code == mind ? f.player[p].list_grave : f.player[p].list_remove;
        EXPECT(has(destination, named) == (removed > 0), "card %u seat%d destination",code,p);
    }
    EXPECT(sd::stray_logs == 0, "card %u Lua errors: %d", code, sd::stray_logs);
    OCG_DestroyDuel(d);
    std::printf("%s card=%u n=%d tag=%d hit=%d\n", failures == before ? "PASS" : "FAIL",code,n,tag,hit);
}

// Real Acropolis activation with an inert Artmage monster in the Deck.
static void search(int n, bool tag, int actor) {
    const int before=failures;
    sd::stray_logs=0;
    auto d=sd::create(setup(n,tag),1,true);
    auto& f=sd::F(d);
    for(int p=0;p<n;++p) {
        f.player[p].start_count=0; f.player[p].draw_count=0;
        for(int i=0;i<10;++i) sd::add(d,p,other,LOCATION_DECK);
    }
    sd::add(d,actor,named,LOCATION_DECK);
    for(auto* c:f.player[actor].list_main) if(c->data.code==named) c->data.setcodes.insert(0x1c7);
    sd::add(d,actor,cost,LOCATION_HAND);
    sd::add(d,actor,acropolis,LOCATION_SZONE,POS_FACEUP_ATTACK,5);
    OCG_StartDuel(d);
    bool activated=false,finished=false; int announced=0;
    for(int step=0;step<500&&!finished;++step) {
        std::vector<sd::Msg> msgs; const sd::Msg* ignored=nullptr;
        if(sd::step(d,msgs,ignored)!=OCG_DUEL_STATUS_AWAITING) continue;
        if(msgs.empty()) break;
        const auto& m=msgs.back(); const auto* p=m.p;
        switch(m.id) {
        case MSG_SELECT_IDLECMD: {
            if(p[0]!=actor) { sd::answer32(d,7); break; }
            if(activated) { finished=true; break; }
            // Find this field spell's ignition effect in the activation list.
            size_t off=1; const size_t sizes[]={10,10,7,10,10};
            for(int k=0;k<5;++k) { auto count=u32(p+off); off+=4+count*sizes[k]; }
            auto count=u32(p+off); off+=4;
            int index=-1;
            for(uint32_t k=0;k<count;++k) if(u32(p+off+19*k)==acropolis) index=k;
            EXPECT(index>=0,"Acropolis search unavailable n%d tag%d actor%d",n,tag,actor);
            if(index<0) { finished=true; break; }
            activated=true; sd::answer32(d,5|(index<<16)); break;
        }
        case MSG_SELECT_CHAIN: sd::answer32(d,-1); break;
        case MSG_SELECT_CARD: {
            EXPECT(p[0]==actor,"Acropolis chooser is its controller");
            const uint32_t answer[]={0,1,0}; OCG_DuelSetResponse(d,answer,sizeof(answer)); break;
        }
        case MSG_ANNOUNCE_CARD:
            ++announced; EXPECT(p[0]==actor,"Acropolis announcement controller"); sd::answer32(d,named); break;
        default: EXPECT(false,"Acropolis unexpected prompt %u",m.id); finished=true; break;
        }
    }
    EXPECT(finished&&activated&&announced==1,"Acropolis completed search n%d tag%d actor%d",n,tag,actor);
    for(int p=0;p<n;++p) {
        EXPECT(has(f.player[p].list_hand,named)==(p==actor),"Acropolis search recipient seat%d",p);
        EXPECT(has(f.player[p].list_grave,cost)==(p==actor),"Acropolis cost payer seat%d",p);
    }
    EXPECT(sd::stray_logs==0,"Acropolis search Lua errors %d",sd::stray_logs);
    OCG_DestroyDuel(d);
    std::printf("%s Acropolis search n=%d tag=%d actor=%d\n",failures==before?"PASS":"FAIL",n,tag,actor);
}

static void declaration_state(int n, bool tag) {
    const int before = failures;
    sd::stray_logs = 0;
    auto d = sd::create(setup(n,tag), 1, true);
    for(int p=0; p<n; ++p) sd::add(d,p,acropolis,LOCATION_SZONE,POS_FACEUP_ATTACK,5);
    // Exercise real helper scopes and stock turn-end reset registrations. A
    // replaced table loses its metatable even though a first-turn test passes.
    {
    interpreter::scope_guard scope(static_cast<duel*>(d)->lua);
    EXPECT(scope.push(0), "Acropolis declaration test needs a real duelist scope");
    sd::lua(d, "local expected_seats=" + std::to_string(n) + R"LUA(
local s=c74733322
local function check_round()
    local first={}
    local visited=0
    aux.MPForEachDuelist(function(tp,seat)
        visited=visited+1
        local key=aux.MPKey(tp)
        local names=s.declared_names[tp]
        assert(type(names)=='table','missing declaration table')
        assert(#names==(first[key] and 1 or 0),'declarations crossed FFA seats or failed to share Tag team')
        if not first[key] then table.insert(names,91990) first[key]=true end
    end)
    assert(visited==expected_seats,'declaration test did not visit every seat')
end
check_round()
aux.ValuesReset()
assert(getmetatable(s.declared_names),'turn reset discarded seat mapping')
check_round()
)LUA");
    }
    EXPECT(sd::stray_logs == 0, "Acropolis n%d tag%d: Lua errors %d",n,tag,sd::stray_logs);
    OCG_DestroyDuel(d);
    std::printf("%s Acropolis declaration reset n=%d tag=%d\n", failures==before?"PASS":"FAIL",n,tag);
}
int main() {
    sd::types[cost]=TYPE_SPELL; sd::types[mind]=TYPE_TRAP; sd::types[designator]=TYPE_SPELL; sd::types[acropolis]=TYPE_SPELL|TYPE_FIELD;
    for(uint32_t c : {named,other,cost}) sd::scripts[c]="local s,id=GetID() function s.initial_effect(c) end";
    for(int mode=0; mode<3; ++mode) {
        int n=mode==0?3:4; bool tag=mode==2;
        for(uint32_t code : {mind,designator}) for(bool hit : {false,true}) flow(n,tag,code,hit);
        search(n,tag,0); search(n,tag,n-1);
        declaration_state(n,tag);
    }
    std::printf("engine-data-cards: %d failures\n",failures);
    return failures ? 1 : 0;
}
