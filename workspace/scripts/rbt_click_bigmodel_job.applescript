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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div');for(var i=0;i<divs.length;i++){var t=divs[i].innerText.trim();if(t.indexOf('大模型算法工程师-工业智能')>=0&&t.length<40&&divs[i].offsetHeight>0){divs[i].scrollIntoView();divs[i].click();return 'clicked';}}return 'not_found';})()"
	set r to execute tab_ javascript js
	delay 2
	return r
end tell