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
	
	-- Click greet button for candidate at specific card index
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var btns=doc.querySelectorAll('.btn-greet');if(btns.length>1){btns[1].scrollIntoView();btns[1].click();return 'clicked_1';}return 'notfound';})()"
	set r to execute tab_ javascript js
	delay 2
	return r
end tell