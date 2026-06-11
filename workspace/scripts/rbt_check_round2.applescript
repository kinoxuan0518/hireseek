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
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var r='';var ids=[0,1,2,6,8,12,14];for(var idx=0;idx<ids.length;idx++){var i=ids[idx];if(i>=cards.length){continue;}var txt=cards[i].innerText;var name=txt.split('\\n')[1]||'unk';var btn=cards[i].querySelector('.btn-greet');r+=i+':'+name.trim()+'|btn='+(btn?'Y':'N')+'\\n';}return r;})()"
	set r to execute tab_ javascript js
	return r
end tell