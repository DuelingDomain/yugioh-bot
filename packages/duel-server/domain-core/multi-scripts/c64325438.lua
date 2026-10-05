if not aux.MPForEachDuelist then return end
-- Every duelist draws 1 card instead (R1, Q3, Tag partner included). The target needs every duelist to be able to draw.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDraw(tp_i,1) end) end
end
function s.repop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	aux.MPForEachDuelist(function(tp_i) Duel.Draw(tp_i,1,REASON_EFFECT) end)
	if e:IsSpellTrapEffect() and e:IsHasType(EFFECT_TYPE_ACTIVATE) then
		c:CancelToGrave(false)
	end
end

if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	local ch=Duel.MPPreviousChain(true)
	return ep==1-tp and ch>0 and Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_CONTROLER)==tp
		and Duel.GetChainInfo(ch,CHAININFO_TRIGGERING_EFFECT):GetHandler():IsSetCard(SET_GENERAIDER)
end
