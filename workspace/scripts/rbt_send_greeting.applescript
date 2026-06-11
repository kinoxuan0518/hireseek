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
	
	-- Check for popup/send button
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var btns=doc.querySelectorAll('button');var r='';for(var i=0;i<btns.length;i++){if(btns[i].innerText.indexOf('发送')>=0){r+='send_btn:'+i+' ';}}var spans=doc.querySelectorAll('span');for(var i=0;i<spans.length;i++){if(spans[i].innerText.indexOf('发送')>=0){r+='send_span:'+i+' ';}}return r||'no_send';})()"
	set r to execute tab_ javascript js
	return r
end tell