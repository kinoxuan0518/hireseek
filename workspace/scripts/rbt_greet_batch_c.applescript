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
	
	set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=0){return 'skip';}var card=cards[0];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r to execute tab_ javascript js
	delay 2
	
	set js2 to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=1){return 'skip';}var card=cards[1];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r2 to execute tab_ javascript js2
	delay 2
	
	set js3 to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=2){return 'skip';}var card=cards[2];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r3 to execute tab_ javascript js3
	delay 2
	
	set js4 to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=4){return 'skip';}var card=cards[4];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r4 to execute tab_ javascript js4
	delay 2
	
	return r & " " & r2 & " " & r3 & " " & r4
end tell