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
	
	set out to ""
	
	-- Greet card 4 (祝筱妍)
	set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=4){return 'skip';}var card=cards[4];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'greeted_4';})()"
	set r to execute tab_ javascript js
	set out to out & r & " "
	delay 3
	
	-- Greet card 5 (王晨)
	set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=5){return 'skip';}var card=cards[5];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'greeted_5';})()"
	set r to execute tab_ javascript js
	set out to out & r & " "
	delay 3
	
	-- Greet card 6 (蔡子豪)
	set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=6){return 'skip';}var card=cards[6];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'greeted_6';})()"
	set r to execute tab_ javascript js
	set out to out & r & " "
	delay 3
	
	-- Greet card 7 (黄齐)
	set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=7){return 'skip';}var card=cards[7];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'greeted_7';})()"
	set r to execute tab_ javascript js
	set out to out & r & " "
	delay 3
	
	-- Greet card 8 (李励阳)
	set js to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');if(cards.length<=8){return 'skip';}var card=cards[8];var btn=card.querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'greeted_8';})()"
	set r to execute tab_ javascript js
	set out to out & r & " "
	delay 3
	
	return out
end tell