#include "scripted-duel.h"
#include "card.h"
#include "interpreter.h"
#include "fold.h"

#include "native-action-apis.cpp"

int main(int argc, char**) {
 const bool action = argc > 1;
 if(action && action_apis()) return 1;
 for (int mode = 0; mode < 4; ++mode) {
  const int n = mode == 0 ? 2 : mode == 1 ? 3 : 4;
  const char* setup = mode == 0 ? "" : mode == 1 ? "Debug.SetupDuelists(3,0,1,2)" : mode == 2 ? "Debug.SetupDuelists(4,0,1,2,3)" : "Debug.SetupDuelists(4,0,1,0,1)";
  auto d = sd::create(setup); auto* duel = static_cast<::duel*>(d); auto* I = duel->lua;
  auto* c = duel->new_card(5000); c->owner = n-1; c->current.controler = 0;
  interpreter::pushobject(I->lua_state,c); lua_setglobal(I->lua_state,"owned");
  if (action) sd::lua(d,"assert(Duel.MPActionSeat("+std::to_string(n-1)+")=="+std::to_string(n-1)+") assert(Duel.MPActionSeat(256)=="+std::to_string(n>2?255:PLAYER_NONE)+")");
 I->push_scope(0);
  sd::lua(d,"assert(Duel.MPOwnerSeat(owned)=="+std::to_string(n-1)+")");
  if (action) {
   auto check_hint = [&]() {
    duel->generate_buffer(); duel->clear_buffer();
    sd::lua(d,mode==0 ? "Duel.Hint(HINT_SELECTMSG,Duel.MPActionSeat(0),HINTMSG_DESTROY)" : "Duel.Hint(HINT_SELECTMSG,Duel.MPActionSeat(),HINTMSG_DESTROY)");
    duel->generate_buffer();
    const auto& data=duel->buff;
    uint64_t desc=0;
    if (data.size()!=15 || data[4]!=MSG_HINT || data[5]!=HINT_SELECTMSG || data[6]!=0) {
     std::printf("hint mode %d: %zu bytes:",mode,data.size());
     for (auto byte:data) std::printf(" %02x",byte);
     std::printf("\n"); return false;
    }
    std::memcpy(&desc,data.data()+7,sizeof(desc));
    if (desc!=502) std::printf("hint mode %d description %llu\n",mode,static_cast<unsigned long long>(desc));
    return desc==502;
   };
   if (!check_hint()) { std::printf("FAIL exact actor selection hint\n"); return 4; }
   sd::lua(d,"assert(Duel.MPActionSeat(0)=="+std::to_string(n>2?128:0)+") assert(Duel.MPActionSeat(256)==PLAYER_NONE) assert(Duel.MPActionSeat(-1)==PLAYER_NONE) assert(Duel.MPActionSeat(4)==PLAYER_NONE)");
   if (n>2) {
    // Keep the actor through a partner rebind, and preserve the declared recipient.
    sd::lua(d,"assert(Duel.MPActionSeat()==128) assert(Duel.MPBindSeat(1))");
    if (mode==3) {
     sd::lua(d,"local ok,p=Duel.MPNthDuelist(3) assert(ok and p==2) assert(Duel.MPActionSeat()==128)");
     if (!check_hint()) { std::printf("FAIL exact actor selection hint after Tag rebind\n"); return 5; }
     sd::lua(d,"Duel.MPNthDuelist(0)");
    }
    if (fold::unfold_action(duel,128,"exact actor")!=0 || I->scope_bound_opp()!=1) return 2;
    duel->game_field->player[1].eliminated=true;
    if (fold::unfold_action(duel,129,"dead actor")!=fold::INVALID) return 3;
   }
  }
  I->pop_scope(); OCG_DestroyDuel(d);
 }
 if (sd::stray_logs) return 1;
 std::printf("PASS real owner and %s: 1v1, FFA3, FFA4, Tag\n",action?"exact action players":"stock player paths");
 return 0;
}
