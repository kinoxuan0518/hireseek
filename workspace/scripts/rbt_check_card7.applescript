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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');if(cards.length<=7){return 'no_card7';}var card=cards[7];var name=card.querySelector('.name');name=name?name.innerText:card.innerText.substring(0,40);var btn=card.querySelector('.btn-greet');return 'name='+name+'|btn='+(btn?'yes':'no');})()"
	set r to execute tab_ javascript js
	return r
end tell