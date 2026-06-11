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
	
	set js to "(function(){var ul=document.querySelector('iframe').contentDocument.querySelector('ul.recommend-card-list');if(!ul){return 'skip';}var lis=ul.querySelectorAll('li');if(lis.length<=4){return 'skip';}var btn=lis[4].querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'd4';})()"
	set r to execute tab_ javascript js
	delay 2
	
	set js2 to "(function(){var ul=document.querySelector('iframe').contentDocument.querySelector('ul.recommend-card-list');if(!ul){return 'skip';}var lis=ul.querySelectorAll('li');if(lis.length<=6){return 'skip';}var btn=lis[6].querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'd6';})()"
	set r2 to execute tab_ javascript js2
	delay 2
	
	set js3 to "(function(){var ul=document.querySelector('iframe').contentDocument.querySelector('ul.recommend-card-list');if(!ul){return 'skip';}var lis=ul.querySelectorAll('li');if(lis.length<=8){return 'skip';}var btn=lis[8].querySelector('.btn-greet');if(!btn){return 'skip';}btn.scrollIntoView();btn.click();return 'd8';})()"
	set r3 to execute tab_ javascript js3
	
	return r & " " & r2 & " " & r3
end tell