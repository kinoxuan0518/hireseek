on run argv
	set cardIdx to item 1 of argv as integer
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
		set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=" & cardIdx & "){return 'no_card_" & cardIdx & "';}var card=cards[" & cardIdx & "];var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn_" & cardIdx & "';}btn.scrollIntoView();btn.click();return 'done_" & cardIdx & "';})()"
		set r to execute tab_ javascript js
		return r
	end tell
end run