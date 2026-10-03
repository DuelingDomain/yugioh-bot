if not aux.MPAny then return end
-- Appointer of the Red Lotus (script fix, late-cards, R3 + R-COMMON-OPP-PICK): the banished card goes back to the hand of its OWNER.
-- The stock operation is Duel.SendtoHand(tc,1-tp,...); the fix passes nil, which is the hand of the owner. The card leaves in the End Phase of the NEXT opponent turn, and that turn can be
-- the turn of an opponent that is not the picked one (FFA: turn order). 1-tp then reads as the turn player, and the card was added to the
-- hand of that duelist. The owner is the duelist whose hand the card left (the picked opponent), in every format.
function s.retop(e,tp,eg,ep,ev,re,r,rp)
	local tc=e:GetLabelObject()
	Duel.SendtoHand(tc,nil,REASON_EFFECT)
end
