// Check hint recipients and unchanged scopes on a real native core. No installed core is changed.
#include <cstdio>
#include "scripted-duel.h"
#include "interpreter.h"

static void check(int n,bool tag,int actor,int htype,int value,std::vector<int> want,int dead=-1,int bound=-1) {
  std::string setup;
  if(n>2) {
    setup="Debug.SetupDuelists("+std::to_string(n);
    for(int seat=0;seat<n;++seat) setup+=","+std::to_string(tag ? seat%2 : seat);
    setup+=")";
  }
  sd::stray_logs=0;
  auto d=sd::create(setup);
  auto& f=sd::F(d);
  auto* lua=static_cast<duel*>(d)->lua;
  if(dead>=0) { f.player[dead].eliminated=true; f.player[dead].lp=0; }
  std::vector<int> lp;
  for(int seat=0;seat<n;++seat) lp.push_back(f.lp_ref(seat));
  if(n>2) {
    lua->push_scope(actor);
    if(bound>=0) lua->current_scope()->own_bound=bound;
  }
  uint32_t start=0;
  OCG_DuelGetMessage(d,&start);
  const auto selections=f.core.select_options.size();
  sd::lua(d,"Duel.Hint("+std::to_string(htype)+","+std::to_string(value)+",777)");
  uint32_t length=0;
  const auto* bytes=static_cast<const uint8_t*>(OCG_DuelGetMessage(d,&length));
  std::vector<int> got;
  for(uint32_t pos=start;pos+4<=length;) {
    uint32_t size=0; std::memcpy(&size,bytes+pos,4);
    if(size>=11 && bytes[pos+4]==MSG_HINT) got.push_back(bytes[pos+6]);
    pos+=4+size;
  }
  EXPECT(got==want,"n=%d tag=%d actor=%d type=%d: wrong recipients",n,tag,actor,htype);
  EXPECT(f.core.select_options.size()==selections,"hint queued a pick");
  if(n>2) {
    EXPECT(!lua->current_scope()->touched,"hint marked the activation probe");
    EXPECT(lua->current_scope()->own_bound==(bound>=0 ? bound : DUELIST_NONE),"hint changed the bind");
    lua->pop_scope();
  }
  for(int seat=0;seat<n;++seat) EXPECT(f.lp_ref(seat)==lp[seat],"hint changed LP of seat %d",seat);
  EXPECT(sd::stray_logs==0,"hint gave a Lua error");
  OCG_DestroyDuel(d);
}
int main() {
  check(3,false,1,HINT_OPSELECTED,1,{0,2});
  check(3,false,2,HINT_OPSELECTED,1,{0,1});
  check(4,false,3,HINT_OPSELECTED,1,{0,1,2});
  check(4,false,1,HINT_MESSAGE,1,{0,2,3});
  check(4,false,1,HINT_MESSAGE,1,{0,2,3},-1,3);
  check(4,false,1,HINT_MESSAGE,1,{2,3},0);
  check(4,true,1,HINT_OPSELECTED,0,{0,2});
  check(4,true,2,HINT_MESSAGE,1,{1,3});
  check(4,true,1,HINT_SELECTMSG,1,{1});
  check(2,false,0,HINT_OPSELECTED,0,{1});
  check(2,false,1,HINT_OPSELECTED,1,{0});
  check(2,false,0,HINT_MESSAGE,1,{1});
  std::printf("Hint checks: %d failures\n",failures);
  return failures ? 1 : 0;
}
