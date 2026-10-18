if not aux.MPAny then return end
if Duel.MPMode()==2 then
	-- Joined teams exchange every monster atomically. Each card crosses to its
	-- fixed facing controller (0/1 or 2/3); that receiver chooses the MMZ.
	-- Check each real outgoing group: six monsters cannot fit in its facing MMZ.
	function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
		local g1=Duel.GetFieldGroup(tp,LOCATION_MZONE,0)
		local g2=Duel.GetFieldGroup(tp,0,LOCATION_MZONE)
		local g=g1+g2
		if chk==0 then
			if not Duel.MPTagSwapControl or #g1==0 or #g1~=#g2 or g:FilterCount(s.filter,nil)>0 then return false end
			local counts={}
			for c in aux.Next(g) do
				local seat=Duel.MPSeatOf(c)
				counts[seat]=(counts[seat] or 0)+1
				if counts[seat]>5 then return false end
			end
			return true
		end
		Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,#g,0,0)
	end
	function s.activate(e,tp,eg,ep,ev,re,r,rp)
		Duel.MPTagSwapControl(Duel.GetFieldGroup(tp,LOCATION_MZONE,0),Duel.GetFieldGroup(tp,0,LOCATION_MZONE))
	end
	return
end
if Duel.MPMode()~=1 or not aux.MPOne then return end
-- Owner 2026-10-18: Compare one opponent at a time. The chosen pair alone swaps its monsters.
local mp_target=s.target
local mp_check=aux.MPAny(mp_target)
local mp_target_one=aux.MPOne(mp_target)
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return mp_check(e,tp,eg,ep,ev,re,r,rp,chk) end
	return mp_target_one(e,tp,eg,ep,ev,re,r,rp,chk)
end
s.activate=aux.MPOne(s.activate)
