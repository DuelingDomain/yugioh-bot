if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Removing a player removes their unresolved links. Count active links and keep saved link IDs stable.
function s.chcon(p)
	return function(e,tp,eg,ep,ev,re,r,rp)
		return rp==(tp~p) and Duel.MPChainCount()>=5 and e:GetHandler():GetFlagEffect(1)>0
	end
end
