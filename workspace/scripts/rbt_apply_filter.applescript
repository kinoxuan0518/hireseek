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
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var btns=doc.querySelectorAll('div');for(var i=0;i<btns.length;i++){if(btns[i].innerText.indexOf('应用')>=0&&btns[i].className.indexOf('recover')>=0){btns[i].click();return 'recover_clicked';}}return 'recover_not_found';})()"
	set r to execute tab_ javascript js
	return r
end tell
