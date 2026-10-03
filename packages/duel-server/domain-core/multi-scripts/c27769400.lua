if not aux.MPKey then return end
-- Tualatin: the state (s[0] the monsters of the opponents of the turn player, s[1] their count) is global and has ONE slot. In FFA the stock
-- group holds the monsters of EVERY opponent of the turn player together, so the event was raised only when the monsters of ALL of them were
-- destroyed (and then for every holder), and the event carried no seat. This overlay keeps one group and one count per key (aux.MPKeyOfSeat:
-- the seat in FFA, the team in Tag; read in the global check, where a player value is a real seat), skips the key of the turn player, and
-- raises the event with a bit mask of the keys whose monsters (2 or more at the start of the Battle Phase) were all destroyed by battle.
-- The condition asks for the own key in that mask (the Lua value tp is the own seat in FFA and the own team in Tag). Two seats: the stock.
local stock_checkop1,stock_checkop2,stock_spcon=s.checkop1,s.checkop2,s.spcon
s.mpg={}
s.mpn={}
function s.checkop1(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()==0 then return stock_checkop1(e,tp,eg,ep,ev,re,r,rp) end
	local turn=aux.MPKeyOfSeat(Duel.GetTurnPlayer())
	local seen={}
	for seat=0,3 do
		local k=aux.MPKeyOfSeat(seat)
		if not seen[k] then
			seen[k]=true
			local g=s.mpg[k]
			if not g then
				g=Group.CreateGroup()
				g:KeepAlive()
				s.mpg[k]=g
			end
			g:Clear()
			if k~=turn then g:Merge(Duel.GetFieldGroup(seat,LOCATION_MZONE,0)) end
			s.mpn[k]=g:GetCount()
		end
	end
end
function s.checkop2(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()==0 then return stock_checkop2(e,tp,eg,ep,ev,re,r,rp) end
	local gy=eg:Filter(Card.IsLocation,nil,LOCATION_GRAVE)
	local mask=0
	for k,g in pairs(s.mpg) do
		if (s.mpn[k] or 0)>=2 and g:GetCount()>0 then
			g:Sub(gy)
			if g:GetCount()==0 then mask=mask|(1<<k) end
		end
	end
	if mask~=0 then Duel.RaiseEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,0,0,mask) end
end
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()==0 then return stock_spcon(e,tp,eg,ep,ev,re,r,rp) end
	return Duel.IsTurnPlayer(1-tp) and (ev&(1<<aux.MPKey(tp)))~=0
end

-- R-FFA-OPP-RESPONSE: bind the opponent who caused the battle event.
-- Bind the turn player before the target probe can ask for another opponent.
local mp_lock_initial=s.initial_effect
function s.initial_effect(c)
 local register=Card.RegisterEffect
 Card.RegisterEffect=function(card,eff,...)
  if card==c and eff:GetCode()==EVENT_SPSUMMON_SUCCESS then
   local target=eff:GetTarget()
   eff:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,...)
    if Duel.MPMode()==1 then Duel.MPBindSeat(Duel.MPSeat(Duel.GetTurnPlayer())) end
    if target then return target(e,tp,eg,ep,ev,re,r,rp,chk,...) end
    if chk==0 then return true end
   end)
  end
  return register(card,eff,...)
 end
 local ok,err=pcall(mp_lock_initial,c)
 Card.RegisterEffect=register
 if not ok then error(err,0) end
end
