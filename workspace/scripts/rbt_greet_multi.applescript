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
	
	-- Card 15 (李泽晨 - AI agent)
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');if(cards.length<=15){return 'no_card';}var card=cards[15];var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r15 to execute tab_ javascript js
	set out to out & "15:" & r15 & " "
	delay 3
	
	-- Card 29 (Dino - 港中文)
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');if(cards.length<=29){return 'no_card';}var card=cards[29];var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r29 to execute tab_ javascript js
	set out to out & "29:" & r29 & " "
	delay 3
	
	-- Card 22 (解晓然 - 加拿大硕士)
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');if(cards.length<=22){return 'no_card';}var card=cards[22];var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r22 to execute tab_ javascript js
	set out to out & "22:" & r22 & " "
	delay 3
	
	-- Card 14 (张曦 - 美国留学)
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');if(cards.length<=14){return 'no_card';}var card=cards[14];var btn=card.querySelector('.btn-greet');if(!btn){return 'no_btn';}btn.scrollIntoView();btn.click();return 'done';})()"
	set r14 to execute tab_ javascript js
	set out to out & "14:" & r14 & " "
	delay 3
	
	return out
end tell