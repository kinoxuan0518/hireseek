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
	
	set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=8){return 'skip';}var card=cards[8];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'greeted_8';})()"
	set r to execute tab_ javascript js
	delay 3
	
	set js2 to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=9){return 'skip';}var card=cards[9];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'greeted_9';})()"
	set r2 to execute tab_ javascript js2
	
	return r & " " & r2
end tell