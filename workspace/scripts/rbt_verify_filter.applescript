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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var wrap=doc.querySelector('.filter-wrap');var open=wrap&&wrap.offsetHeight>100;var cards=doc.querySelectorAll('.card-item, li');var c=0;for(var i=0;i<cards.length;i++){if(cards[i].innerText.indexOf('btn-greet')>=0||cards[i].querySelector('.btn-greet')){c++;}}return 'open='+open+'|cards='+c;})()"
	set r to execute tab_ javascript js
	return r
end tell