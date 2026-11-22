-- Arcana Force EX - The Chaos Ruler: shared Standard/Domain, 1v1/multiplayer bug fix.
-- Upstream: ProjectIgnis/CardScripts official/c12686296.lua at 37f270dc813a.
-- Fusion.ContactCon only accepts a face-down Fusion Monster, which an Extra Deck card is.
-- A Deck Master in the Deck Master Zone is face-up, so its own Contact Fusion procedure
-- never started (Domain Format Complete Rulebook v1.4: a Deck Master may use its own
-- summon mechanic from the zone). Accept that zone; everything else is the stock check.
-- The first line below is a named function that no effect uses: it keeps the Remote Duels
-- card scan (which reads top-level functions) on the stock effects, so its table does not change.
function s.dmz_contact_con(f,fcon,summonToPlayer,summonToZones)
	return function(e,c)
		if c==nil then return true end
		local m=f(e:GetHandlerPlayer())
		local chkp=summonToPlayer==1 and (1-c:GetControler()) or c:GetControler()
		local chkf=chkp|FUSPROC_CONTACTFUS|((summonToZones and summonToZones or 0)<<40)
		local hidden=c:IsFacedown() or (LOCATION_DECKMASTER~=nil and c:IsLocation(LOCATION_DECKMASTER))
		return hidden and c:CheckFusionMaterial(m,nil,chkf) and (not fcon or fcon(e:GetHandlerPlayer()))
	end
end
local stock_initial_effect=s.initial_effect
s.initial_effect=function(c)
	local stock_contact_con=Fusion.ContactCon
	Fusion.ContactCon=s.dmz_contact_con
	local ok,err=pcall(stock_initial_effect,c)
	Fusion.ContactCon=stock_contact_con
	if not ok then error(err,0) end
end
