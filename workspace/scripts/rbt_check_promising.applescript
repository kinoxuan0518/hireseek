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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cards=doc.querySelectorAll('.card-item');var ids=[19,21,24,27,33,39,42,43];var r='';for(var idx=0;idx<ids.length;idx++){var i=ids[idx];if(i>=cards.length){continue;}var txt=cards[i].innerText;var lines=txt.split('\\n');var name=lines[1]||'unk';var btn=cards[i].querySelector('.btn-greet');var is27=txt.indexOf('27年')>=0||txt.indexOf('2027')>=0;r+=i+':'+name.trim()+'|btn='+(btn?'Y':'N')+'|27='+(is27?'Y':'N')+'|txt='+txt.substring(0,80)+'\\n';}return r;})()"
	set r to execute tab_ javascript js
	return r
end tell