-- The lasting negation belongs to the activated effect's chosen opponent.
if not aux.MPColumnGeometry then return end
local mp_activate=s.activate
function s.activate(e,tp,...)
	if not aux.MPColumnGeometry() or aux.MPGeometryShared() then return mp_activate(e,tp,...) end
	local own=aux.MPGeometrySeat(tp)
	local peer=aux.MPColumnPeerSeat(own)
	local register=Duel.RegisterEffect
	Duel.RegisterEffect=function(effect,player,...)
		if effect:GetTarget()==s.distg or effect:GetOperation()==s.disop then
			effect:SetLabel(effect:GetLabel(),peer,own)
		end
		return register(effect,player,...)
	end
	local ok,result=pcall(mp_activate,e,tp,...)
	Duel.RegisterEffect=register
	if not ok then error(result,0) end
	return result
end
local mp_distg=s.distg
function s.distg(e,c)
	local seq,peer,own=e:GetLabel()
	if peer~=nil then
		local seat=Duel.MPSeatOf(c)
		if seat~=own and seat~=peer then return false end
		if seat~=own then seq=4-seq end
		return c:IsSpellTrap() and seq==c:GetSequence() and c:GetFlagEffect(id)==0
	end
	local tp=e:GetHandlerPlayer()
	if aux.MPColumnGeometry() then
		local own,seat=aux.MPGeometrySeat(tp),Duel.MPSeatOf(c)
		if seat~=own and seat~=aux.MPColumnPeerSeat(own) then return false end
	end
	return mp_distg(e,c)
end
local mp_disop=s.disop
local geometry_disop=aux.MPColumnChainFilter(mp_disop)
function s.disop(e,tp,eg,ep,ev,re,r,rp)
	local _,peer,own=e:GetLabel()
	if peer==nil then return geometry_disop(e,tp,eg,ep,ev,re,r,rp) end
	local seat=Duel.MPChainSeat(ev)
	if seat~=own and seat~=peer then return end
	return mp_disop(e,tp,eg,ep,ev,re,r,rp)
end
s.initial_effect=aux.MPColumnEffects(s.initial_effect,{s.activate})
