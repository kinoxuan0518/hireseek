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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var tabs=doc.querySelectorAll('.tab-item');for(var i=0;i<tabs.length;i++){if(tabs[i].innerText.indexOf('最新')>=0){tabs[i].click();return 'clicked_latest';}}return 'not_found';})()"
	set r to execute tab_ javascript js
	delay 2
	
	set js2 to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');return String(cards.length);})()"
	set r2 to execute tab_ javascript js2
	return r & " cards=" & r2
end tell