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
	
	-- Click greet button for candidate at card index 1 (邓雪婷)
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');if(cards.length<=1){return 'no_card';}var card=cards[1];var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn';}btn.scrollIntoView();btn.click();return 'clicked_card1';})()"
	set r to execute tab_ javascript js
	delay 3
	return r
end tell