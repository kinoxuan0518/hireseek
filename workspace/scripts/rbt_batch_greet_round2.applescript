tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	
	-- greet cards 0,1,2,3,4,5,6,8,11,12,14
	set targetCards to {0, 1, 2, 3, 4, 5, 6, 8, 11, 12, 14}
	set out to ""
	
	repeat with target in targetCards
		set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=" & target & "){return 'no_card_" & target & "';}var card=cards[" & target & "];var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn_" & target & "';}btn.scrollIntoView();btn.click();return 'done_" & target & "';})()"
		set r to execute tab_ javascript js
		set out to out & " " & target & ":" & r
		delay 3
	end repeat
	
	return out
end tell