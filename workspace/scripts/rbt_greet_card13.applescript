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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');if(cards.length<=13){return 'no_card';}var card=cards[13];var txt=card.innerText.substring(0,30);var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn_'+txt;}btn.scrollIntoView();btn.click();return 'clicked_'+txt;})()"
	set r to execute tab_ javascript js
	delay 3
	return r
end tell