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
	set js to "(function(){var iframes=document.querySelectorAll('iframe');var doc=iframes[0].contentDocument||iframes[0].contentWindow.document;var txt=doc.body.innerText;var idx=txt.indexOf('权益');if(idx<0){return txt.substring(0,300);}return txt.substring(Math.max(0,idx-50),idx+100);})()"
	set r to execute tab_ javascript js
	return r
end tell