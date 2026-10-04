if not aux.MPForEachDuelist then return end
-- Only the card controller's own Standby Phase counts; the Tag partner's turn does not count.
function s.damcon(e,tp,eg,ep,ev,re,r,rp)
	return Duel.MPTurnControls(e:GetHandler())
end
-- Every duelist takes the damage (R1, Q3, Tag partner included).
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if not c:IsRelateToEffect(e) then return end
	local dam=c:GetFlagEffectLabel(id)
	if dam==nil then
		c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,0,200)
		dam=200
	else
		dam=dam*2
		c:SetFlagEffectLabel(id,dam)
	end
	aux.MPForEachDuelist(function(tp_i) Duel.Damage(tp_i,dam,REASON_EFFECT,true) end)
	Duel.RDComplete()
end
